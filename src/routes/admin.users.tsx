import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { type CreatedInvite, InviteForm } from "@/components/admin-forms";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, DataRow, Notice, Select } from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AdminInvite, AdminUser, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/users")({
	component: UsersPage,
});

type InviteWithStatus = AdminInvite & {
	status: "pending" | "expired" | "accepted";
};

function UsersPage() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [invites, setInvites] = useState<AdminInvite[]>([]);
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(
		null,
	);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [nextUsers, nextInvites, nextRoles] = await Promise.all([
				unwrap<AdminUser[]>(await api.admin.users.get()),
				unwrap<AdminInvite[]>(await api.admin.invites.get()),
				unwrap<AssignableRole[]>(await api.admin.roles.assignable.get()),
			]);
			setUsers(nextUsers);
			setInvites(nextInvites);
			setRoles(nextRoles);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable within this component; re-fetch only when the authenticated user identity changes.
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

	if (!hasPermission("users.read")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const activeUsers = users.filter((u) => u.isActive);
	const disabledUsers = users.filter((u) => !u.isActive);
	const now = Date.now();

	const invitesWithStatus: InviteWithStatus[] = invites.map((invite) => {
		if (invite.acceptedAt) return { ...invite, status: "accepted" };
		if (invite.expiresAt < now) return { ...invite, status: "expired" };
		return { ...invite, status: "pending" };
	});

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<h1 className="text-4xl font-medium">{t("users.title")}</h1>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
			</Card>

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

			<Card>
				<h2 className="text-2xl font-medium">{t("users.invites")}</h2>
				<div className="mt-5 grid gap-3">
					{invitesWithStatus.length ? (
						invitesWithStatus.map((invite) => (
							<DataRow key={invite.id}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div>
										<p className="font-medium">{invite.email}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											<span
												className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
													invite.status === "pending"
														? "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100"
														: invite.status === "accepted"
															? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100"
															: "bg-muted text-muted-foreground"
												}`}
											>
												{t(
													`users.status${
														invite.status.charAt(0).toUpperCase() +
														invite.status.slice(1)
													}`,
												)}
											</span>
											{" · "}
											{invite.status === "pending"
												? `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleDateString(locale)}`
												: invite.status === "accepted" && invite.acceptedAt
													? new Date(invite.acceptedAt).toLocaleDateString(
															locale,
														)
													: `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleDateString(locale)}`}
										</p>
										{invite.inviteUrl ? (
											<div className="mt-1 flex items-center gap-2">
												<a
													className="break-all text-xs text-accent underline dark:text-accent"
													href={invite.inviteUrl}
												>
													{invite.inviteUrl}
												</a>
												<CopyButton
													className="shrink-0 !rounded-xl !px-2 !py-2"
													label={t("actions.copyLink")}
													copiedLabel={t("actions.copied")}
													text={invite.inviteUrl}
												/>
											</div>
										) : null}
									</div>
									<Button
										onClick={async () => {
											setError(null);
											try {
												const api = getTreaty();
												await unwrap(
													await api.admin.invites.delete({
														id: invite.id,
													}),
												);
												await refresh();
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
										{t("users.cancelInvite")}
									</Button>
								</div>
							</DataRow>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							{t("users.emptyInvites")}
						</p>
					)}
				</div>
			</Card>

			{hasPermission("invites.manage") ? (
				<Card>
					<h2 className="text-2xl font-medium">{t("actions.addInvite")}</h2>
					{createdInvite ? (
						<div className="mt-4">
							<Notice tone="success">
								<strong>{t("invites.created")}</strong>
								<div className="mt-2 flex items-center gap-2">
									<a
										className="break-all underline underline-offset-4"
										href={createdInvite.inviteUrl}
									>
										{createdInvite.inviteUrl}
									</a>
									<CopyButton
										className="shrink-0 !rounded-xl !px-2 !py-2"
										label={t("actions.copyLink")}
										copiedLabel={t("actions.copied")}
										text={createdInvite.inviteUrl}
									/>
								</div>
							</Notice>
						</div>
					) : null}
					<InviteForm
						onSaved={(invite) => {
							setCreatedInvite(invite);
							void refresh();
						}}
						roles={roles}
						t={t}
					/>
				</Card>
			) : null}
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
		<DataRow>
			<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
				<div className="flex-1">
					<p className="font-medium">
						{u.name}{" "}
						<span className="text-sm font-normal text-muted-foreground">
							({u.email})
						</span>
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{u.roleName} · {u.locale} ·{" "}
						{new Date(u.createdAt).toLocaleDateString(locale)}
					</p>
					{roles.length > 0 ? (
						<div className="mt-3 flex items-center gap-2">
							<label className="text-xs font-bold text-muted-foreground">
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
		</DataRow>
	);
}
