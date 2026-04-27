import {
	createFileRoute,
	Link,
	useParams,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DataRow,
	DeleteConfirmationDialog,
	EmptyState,
	Notice,
} from "@/components/ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminInvite,
	AdminRoleDetail,
	AdminUser,
	InviteListData,
	PermissionCatalog,
	UserListData,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import { PERMISSION_GROUPS, type Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/access/roles/$id")({
	component: RoleDetailPage,
});

function RoleDetailPage() {
	const { id } = useParams({ from: "/admin/access/roles/$id" });
	const router = useRouter();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const {
		isAuthorized,
		isPending: isPermissionPending,
		hasPermission,
	} = useRequirePermission("roles.read");
	const [role, setRole] = useState<AdminRoleDetail | null>(null);
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [pendingInvites, setPendingInvites] = useState<AdminInvite[]>([]);
	const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [roleData, usersData, invitesData, catalogData] = await Promise.all(
				[
					unwrap<AdminRoleDetail>(await api.admin.roles({ id }).get()),
					hasPermission("users.read")
						? loadUsersForRole(api, id)
						: Promise.resolve([]),
					hasPermission("invites.read")
						? loadPendingInvitesForRole(api, id)
						: Promise.resolve([]),
					unwrap<PermissionCatalog>(await api.admin.permissions.get()),
				],
			);
			setRole(roleData);
			setUsers(usersData);
			setPendingInvites(invitesData);
			setCatalog(catalogData);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	async function deleteRole() {
		setError(null);
		try {
			const api = getTreaty();
			await unwrap(await api.admin.roles({ id }).delete());
			await router.navigate({ to: "/admin/access/roles" });
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session or id changes.
	useEffect(() => {
		if (session && !isPermissionPending && isAuthorized) {
			void refresh();
		}
	}, [session?.user.id, id, isPermissionPending, isAuthorized]);

	if (isPending || isPermissionPending) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	if (!isAuthorized) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.permissionDenied")}</Notice>
			</div>
		);
	}

	if (!role && !error) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (error) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>
					<div>
						<Notice tone="error">{t(error)}</Notice>
					</div>
				</Card>
			</div>
		);
	}

	if (!role) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>
					<div>
						<Notice tone="error">{t("errors.roleMissing")}</Notice>
					</div>
				</Card>
			</div>
		);
	}

	const activeUsers = users.filter((u) => u.isActive);
	const disabledUsers = users.filter((u) => !u.isActive);

	return (
		<div className="mx-auto grid w-full max-w-6xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<Link
							className="text-sm font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
							to="/admin/access/roles"
						>
							{t("roles.viewAll")}
						</Link>
						<h1 className="text-4xl font-medium">
							{role.name}
							{role.isSystem ? (
								<span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
									{t("roles.systemBadge")}
								</span>
							) : null}
						</h1>
						{role.description ? (
							<p className="mt-2 text-muted-foreground">{role.description}</p>
						) : null}
					</div>
					<div className="flex gap-2">
						{!role.isSystem && hasPermission("roles.update") ? (
							<Link params={{ id: role.id }} to="/admin/roles/$id/edit">
								<Button tone="secondary" type="button">
									{t("roles.edit")}
								</Button>
							</Link>
						) : null}
						{hasPermission("roles.delete") ? (
							<DeleteConfirmationDialog
								title={t("forms.confirmDelete")}
								description={t("forms.confirmDeleteDescription")}
								confirmLabel={t("forms.delete")}
								cancelLabel={t("forms.cancel")}
								onConfirm={deleteRole}
							>
								<Button
									disabled={
										role.isSystem ||
										role.userCount > 0 ||
										role.pendingInviteCount > 0
									}
									tone="danger"
									type="button"
								>
									{t("roles.delete")}
								</Button>
							</DeleteConfirmationDialog>
						) : null}
					</div>
				</div>
			</Card>

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Stat label={t("roles.users")} value={role.userCount} />
				<Stat label={t("roles.pending")} value={role.pendingInviteCount} />
				<Stat label={t("roles.permissions")} value={role.permissions.length} />
				<Stat
					label={t("roles.scope")}
					text={
						role.domainScopeCount === 0 && role.linkScopeCount === 0
							? t("roles.unrestricted")
							: `${role.domainScopeCount + role.linkScopeCount}`
					}
				/>
			</section>

			{catalog && (
				<Card>
					<h2 className="text-2xl font-medium">{t("roles.permissions")}</h2>
					<p className="mt-1 text-sm text-muted-foreground/80">
						{role.permissions.length} of {catalog.permissions.length} enabled
					</p>
					<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{Object.entries(PERMISSION_GROUPS).map(
							([groupKey, groupPermissions]) => (
								<div
									className="rounded-md border border-border bg-card/60 p-3"
									key={groupKey}
								>
									<p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{t(`roles.permissionGroup.${groupKey}`)}
									</p>
									<div className="grid gap-2">
										{groupPermissions.map((perm) => {
											const isEnabled = role.permissions.includes(perm);
											return (
												<div
													className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
														isEnabled
															? "bg-accent text-accent-foreground"
															: "bg-muted text-muted-foreground/80"
													}`}
													key={perm}
												>
													<span
														className={`inline-flex size-2 shrink-0 rounded-full ${
															isEnabled
																? "bg-accent-foreground"
																: "bg-muted-foreground/30"
														}`}
													/>
													<span className={isEnabled ? "font-medium" : ""}>
														{t(`permissions.${perm}`)}
													</span>
												</div>
											);
										})}
									</div>
								</div>
							),
						)}
					</div>
				</Card>
			)}

			<section className="grid gap-4 lg:grid-cols-2">
				<Card>
					<h2 className="text-2xl font-medium">{t("roles.scopeDomains")}</h2>
					<p className="mt-1 text-sm text-muted-foreground/80">
						{role.domainScopeCount === 0
							? t("roles.unrestricted")
							: t("roles.domainsCount").replace(
									"{{count}}",
									String(role.domainScopeCount),
								)}
					</p>
				</Card>

				<Card>
					<h2 className="text-2xl font-medium">{t("roles.scopeLinks")}</h2>
					<p className="mt-1 text-sm text-muted-foreground/80">
						{role.linkScopeCount === 0
							? t("roles.unrestricted")
							: t("roles.linksCount").replace(
									"{{count}}",
									String(role.linkScopeCount),
								)}
					</p>
				</Card>
			</section>

			<section className="grid gap-4 lg:grid-cols-2">
				<Card>
					<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
						<div>
							<h2 className="text-2xl font-medium">{t("roles.users")}</h2>
							<p className="mt-1 text-sm text-muted-foreground/80">
								{t("roles.usersCount").replace(
									"{{count}}",
									String(users.length),
								)}
							</p>
						</div>
					</div>
					<ScrollArea className="mt-5 h-[360px] rounded-md border border-border">
						<div className="grid gap-3 p-3">
							{users.length ? (
								<>
									{activeUsers.map((u) => (
										<UserRow key={u.id} locale={locale} t={t} user={u} />
									))}
									{disabledUsers.map((u) => (
										<UserRow key={u.id} locale={locale} t={t} user={u} />
									))}
								</>
							) : (
								<EmptyState
									compact
									description={
										hasPermission("users.read")
											? t("roles.noUsers")
											: t("errors.permissionDenied")
									}
								/>
							)}
						</div>
					</ScrollArea>
				</Card>

				<Card>
					<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
						<div>
							<h2 className="text-2xl font-medium">
								{t("roles.pendingInvitesTitle")}
							</h2>
							<p className="mt-1 text-sm text-muted-foreground/80">
								{t("roles.pendingInvites").replace(
									"{{count}}",
									String(pendingInvites.length),
								)}
							</p>
						</div>
					</div>
					<ScrollArea className="mt-5 h-[360px] rounded-md border border-border">
						<div className="grid gap-3 p-3">
							{pendingInvites.length ? (
								pendingInvites.map((invite) => (
									<InviteRow
										invite={invite}
										key={invite.id}
										locale={locale}
										t={t}
										canUpdate={hasPermission("invites.update")}
									/>
								))
							) : (
								<EmptyState
									compact
									description={
										hasPermission("invites.read")
											? t("roles.noPendingInvites")
											: t("errors.permissionDenied")
									}
								/>
							)}
						</div>
					</ScrollArea>
				</Card>
			</section>
		</div>
	);
}

function Stat({
	label,
	value,
	text,
}: {
	label: string;
	value?: number;
	text?: string;
}) {
	return (
		<Card>
			<p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
				{label}
			</p>
			<p className="mt-2 text-4xl font-medium text-foreground">
				{text ?? value ?? 0}
			</p>
		</Card>
	);
}

async function loadUsersForRole(
	api: ReturnType<typeof getTreaty>,
	roleId: string,
) {
	const firstPage = await unwrap<UserListData>(
		await api.admin.users.get({
			query: { active: "all", page: 1, pageSize: 100, roleId },
		}),
	);
	const items = [...firstPage.items];
	for (let page = 2; page <= firstPage.totalPages; page += 1) {
		const nextPage = await unwrap<UserListData>(
			await api.admin.users.get({
				query: { active: "all", page, pageSize: 100, roleId },
			}),
		);
		items.push(...nextPage.items);
	}
	return items;
}

async function loadPendingInvitesForRole(
	api: ReturnType<typeof getTreaty>,
	roleId: string,
) {
	const firstPage = await unwrap<InviteListData>(
		await api.admin.invites.get({
			query: { page: 1, pageSize: 100, roleId, status: "pending" },
		}),
	);
	const items = [...firstPage.items];
	for (let page = 2; page <= firstPage.totalPages; page += 1) {
		const nextPage = await unwrap<InviteListData>(
			await api.admin.invites.get({
				query: { page, pageSize: 100, roleId, status: "pending" },
			}),
		);
		items.push(...nextPage.items);
	}
	return items;
}

function UserRow({
	locale,
	t,
	user: u,
}: {
	locale: string;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
	user: AdminUser;
}) {
	return (
		<DataRow>
			<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
				<div className="flex-1">
					<p className="font-medium">
						<Link
							className="text-accent underline underline-offset-4 dark:text-accent"
							params={{ id: u.id }}
							to="/admin/access/users/$id"
						>
							{u.name}
						</Link>{" "}
						<span className="text-sm font-normal text-muted-foreground">
							({u.email})
						</span>
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{u.isActive ? t("users.active") : t("users.disabled")} -{" "}
						{new Date(u.createdAt).toLocaleDateString(locale)}
					</p>
				</div>
			</div>
		</DataRow>
	);
}

function InviteRow({
	canUpdate,
	invite,
	locale,
	t,
}: {
	canUpdate: boolean;
	invite: AdminInvite;
	locale: string;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	return (
		<DataRow>
			<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">{invite.email}</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("forms.expires")}{" "}
						{new Date(invite.expiresAt).toLocaleDateString(locale)}
						{invite.invitedByName || invite.invitedByEmail ? (
							<>
								{" "}
								- {t("users.invitedBy")}:{" "}
								{invite.invitedBy ? (
									<Link
										className="text-accent underline underline-offset-4 dark:text-accent"
										params={{ id: invite.invitedBy }}
										to="/admin/access/users/$id"
									>
										{invite.invitedByName ?? invite.invitedByEmail}
									</Link>
								) : (
									<span>{invite.invitedByName ?? invite.invitedByEmail}</span>
								)}
							</>
						) : null}
					</p>
				</div>
				{canUpdate ? (
					<div>
						<Link
							className="text-sm font-bold text-accent underline underline-offset-4 dark:text-accent"
							params={{ id: invite.id }}
							to="/admin/invites/$id/edit"
						>
							{t("pages.editInvite")}
						</Link>
					</div>
				) : null}
			</div>
		</DataRow>
	);
}
