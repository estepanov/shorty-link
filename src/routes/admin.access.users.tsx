import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

function PencilIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			viewBox="0 0 24 24"
		>
			<path d="m18 2 4 4-13 13H5v-4z" />
			<path d="m14.5 5.5 4 4" />
		</svg>
	);
}

import {
	Button,
	Card,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminUser, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/users")({
	component: UsersTab,
});

function UsersTab() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("users.read");
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [nextUsers, nextRoles] = await Promise.all([
				unwrap<AdminUser[]>(await api.admin.users.get()),
				unwrap<AssignableRole[]>(await api.admin.roles.assignable.get()),
			]);
			setUsers(nextUsers);
			setRoles(nextRoles);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session identity changes.
	useEffect(() => {
		if (session) {
			void refresh();
		}
	}, [session?.user.id]);

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const activeUsers = users.filter((u) => u.isActive);
	const disabledUsers = users.filter((u) => !u.isActive);

	return (
		<div className="grid gap-6">
			{error ? (
				<Card>
					<Notice tone="error">{t(error)}</Notice>
				</Card>
			) : null}

			<Card>
				<h2 className="text-2xl font-medium">{t("users.active")}</h2>
				<div className="mt-5 grid gap-3">
					{activeUsers.length ? (
						activeUsers.map((u) => (
							<UserRow
								key={u.id}
								locale={locale}
								onRefresh={refresh}
								roles={roles}
								setError={setError}
								t={t}
								user={u}
							/>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							{t("users.emptyActive")}
						</p>
					)}
				</div>
			</Card>

			<Card>
				<h2 className="text-2xl font-medium">{t("users.disabled")}</h2>
				<div className="mt-5 grid gap-3">
					{disabledUsers.length ? (
						disabledUsers.map((u) => (
							<UserRow
								key={u.id}
								locale={locale}
								onRefresh={refresh}
								roles={roles}
								setError={setError}
								t={t}
								user={u}
							/>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							{t("users.emptyDisabled")}
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}

function UserRow({
	locale,
	onRefresh,
	roles,
	setError,
	t,
	user: u,
}: {
	locale: string;
	onRefresh: () => Promise<void>;
	roles: AssignableRole[];
	setError: (message: string | null) => void;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
	user: AdminUser;
}) {
	const [editing, setEditing] = useState(false);
	const [pendingRoleId, setPendingRoleId] = useState(u.roleId);

	return (
		<div className="rounded-md border border-foreground/10 bg-card/60 p-2.5 ">
			<div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
				<div className="flex-1">
					<p className="font-medium">
						{u.name}{" "}
						<span className="text-sm font-normal text-muted-foreground">
							({u.email})
						</span>
					</p>
					<p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
						{editing && roles.length > 0 ? (
							<>
								<Select
									onValueChange={(val) => {
										setPendingRoleId(val);
									}}
									value={pendingRoleId}
								>
									<SelectTrigger className="w-auto">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{roles.map((role) => (
											<SelectItem key={role.id} value={role.id}>
												{role.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									className="!rounded-xl !px-2.5 !py-1.5 !text-xs"
									onClick={async () => {
										if (pendingRoleId === u.roleId) {
											setEditing(false);
											return;
										}
										setError(null);
										try {
											const api = getTreaty();
											await unwrap(
												await api.admin
													.users({ id: u.id })
													.role.patch({ roleId: pendingRoleId }),
											);
											await onRefresh();
											setEditing(false);
										} catch (nextError) {
											setError(
												nextError instanceof Error
													? nextError.message
													: "errors.unknown",
											);
										}
									}}
									type="button"
								>
									{t("forms.save")}
								</Button>
								<Button
									className="!rounded-xl !border-transparent !bg-transparent !px-2.5 !py-1.5 !text-xs hover:!bg-muted"
									onClick={() => {
										setEditing(false);
										setPendingRoleId(u.roleId);
									}}
									tone="secondary"
									type="button"
								>
									{t("forms.cancel")}
								</Button>
							</>
						) : (
							<>
								<span className="font-bold">{u.roleName}</span>
								{roles.length > 0 ? (
									<Button
										className="!rounded-md !border-transparent !bg-transparent !p-1 !h-auto !text-muted-foreground hover:!text-foreground hover:!bg-muted"
										onClick={() => {
											setPendingRoleId(u.roleId);
											setEditing(true);
										}}
										tone="secondary"
										type="button"
									>
										<PencilIcon className="size-3.5" />
									</Button>
								) : null}
							</>
						)}
						<span>·</span>
						<span>{u.locale}</span>
						<span>·</span>
						<span>{new Date(u.createdAt).toLocaleDateString(locale)}</span>
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						className="!rounded-xl !px-3 !py-1.5 !text-xs"
						onClick={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(
									await api.admin.users({ id: u.id }).patch({
										isActive: !u.isActive,
									}),
								);
								await onRefresh();
							} catch (nextError) {
								setError(
									nextError instanceof Error
										? nextError.message
										: "errors.unknown",
								);
							}
						}}
						tone="secondary"
						type="button"
					>
						{u.isActive ? t("users.disable") : t("users.enable")}
					</Button>
					<Button
						className="!rounded-xl !px-3 !py-1.5 !text-xs"
						onClick={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(await api.admin.users({ id: u.id }).delete());
								await onRefresh();
							} catch (nextError) {
								setError(
									nextError instanceof Error
										? nextError.message
										: "errors.unknown",
								);
							}
						}}
						tone="danger"
						type="button"
					>
						{t("users.delete")}
					</Button>
				</div>
			</div>
		</div>
	);
}
