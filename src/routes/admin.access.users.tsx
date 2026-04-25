import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, Notice, Select } from "@/components/ui";
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
				<h2 className="text-2xl font-black">{t("users.active")}</h2>
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
						<p className="text-sm text-stone-600 dark:text-stone-300">
							{t("users.emptyActive")}
						</p>
					)}
				</div>
			</Card>

			<Card>
				<h2 className="text-2xl font-black">{t("users.disabled")}</h2>
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
						<p className="text-sm text-stone-600 dark:text-stone-300">
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
	return (
		<div className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
			<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
				<div className="flex-1">
					<p className="font-black">
						{u.name}{" "}
						<span className="text-sm font-normal text-stone-600 dark:text-stone-300">
							({u.email})
						</span>
					</p>
					<p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
						{u.roleName} · {u.locale} ·{" "}
						{new Date(u.createdAt).toLocaleDateString(locale)}
					</p>
					{roles.length > 0 ? (
						<div className="mt-3 flex items-center gap-2">
							<label className="text-xs font-bold text-stone-700 dark:text-stone-300">
								{t("users.role")}
							</label>
							<Select
								className="!w-auto !py-2"
								onChange={async (event) => {
									const nextRoleId = event.target.value;
									if (nextRoleId === u.roleId) return;
									setError(null);
									try {
										const api = getTreaty();
										await unwrap(
											await api.admin
												.users({ id: u.id })
												.role.patch({ roleId: nextRoleId }),
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
								value={u.roleId}
							>
								{roles.map((role) => (
									<option key={role.id} value={role.id}>
										{role.name}
									</option>
								))}
							</Select>
						</div>
					) : null}
				</div>
				<div className="flex gap-2">
					<Button
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
