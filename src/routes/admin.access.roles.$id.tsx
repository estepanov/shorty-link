import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, DataRow, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminRoleDetail,
	AdminUser,
	PermissionCatalog,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import { PERMISSION_GROUPS, type Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/access/roles/$id")({
	component: RoleDetailPage,
});

function RoleDetailPage() {
	const { id } = useParams({ from: "/admin/access/roles/$id" });
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("roles.manage");
	const [role, setRole] = useState<AdminRoleDetail | null>(null);
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [roleData, usersData, catalogData] = await Promise.all([
				unwrap<AdminRoleDetail>(await api.admin.roles({ id }).get()),
				unwrap<AdminUser[]>(await api.admin.users.get()),
				unwrap<PermissionCatalog>(await api.admin.permissions.get()),
			]);
			setRole(roleData);
			setUsers(usersData.filter((u) => u.roleId === id));
			setCatalog(catalogData);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session or id changes.
	useEffect(() => {
		if (session) {
			void refresh();
		}
	}, [session?.user.id, id]);

	if (isPending) {
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
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
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
						<Button
							disabled={role.isSystem || role.userCount > 0}
							tone="danger"
							type="button"
						>
							{t("roles.delete")}
						</Button>
					</div>
				</div>
			</Card>

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
									className="rounded-md border border-foreground/10 bg-white/50 p-3 "
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
													className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
														isEnabled
															? "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100"
															: "bg-muted text-muted-foreground/80 dark:bg-muted dark:text-muted-foreground/80"
													}`}
													key={perm}
												>
													<span
														className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
															isEnabled
																? "bg-blue-500 dark:bg-blue-400"
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

			<Card>
				<h2 className="text-2xl font-medium">{t("roles.scopeDomains")}</h2>
				<p className="mt-1 text-sm text-muted-foreground/80">
					{role.domainScopeCount === 0
						? t("roles.unrestricted")
						: `${role.domainScopeCount} domains`}
				</p>
			</Card>

			<Card>
				<h2 className="text-2xl font-medium">{t("roles.scopeLinks")}</h2>
				<p className="mt-1 text-sm text-muted-foreground/80">
					{role.linkScopeCount === 0
						? t("roles.unrestricted")
						: `${role.linkScopeCount} links`}
				</p>
			</Card>

			<Card>
				<h2 className="text-2xl font-medium">
					{t("users.active")} ({activeUsers.length})
				</h2>
				<div className="mt-5 grid gap-3">
					{activeUsers.length ? (
						activeUsers.map((u) => (
							<UserRow key={u.id} locale={locale} t={t} user={u} />
						))
					) : (
						<p className="text-sm text-muted-foreground">
							{t("users.emptyActive")}
						</p>
					)}
				</div>
			</Card>

			<Card>
				<h2 className="text-2xl font-medium">
					{t("users.disabled")} ({disabledUsers.length})
				</h2>
				<div className="mt-5 grid gap-3">
					{disabledUsers.length ? (
						disabledUsers.map((u) => (
							<UserRow key={u.id} locale={locale} t={t} user={u} />
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
						{u.name}{" "}
						<span className="text-sm font-normal text-muted-foreground">
							({u.email})
						</span>
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{new Date(u.createdAt).toLocaleDateString(locale)}
					</p>
				</div>
				<div>
					<Link
						className="text-sm font-bold text-accent underline underline-offset-4 dark:text-accent"
						to="/admin/access/users"
					>
						{t("users.title")}
					</Link>
				</div>
			</div>
		</DataRow>
	);
}
