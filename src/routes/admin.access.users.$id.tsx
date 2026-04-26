import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DeleteConfirmationDialog,
	Notice,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminUserDetail } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/users/$id")({
	component: UserDetail,
});

function UserDetail() {
	const { id } = Route.useParams();
	const location = useLocation();
	const router = useRouter();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const {
		hasPermission,
		isAuthorized,
		isPending: isPermissionPending,
	} = useRequirePermission("users.read");
	const [userData, setUserData] = useState<AdminUserDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const isDetailRoute =
		location.pathname === `/admin/access/users/${id}` ||
		location.pathname === `/admin/access/users/${id}/`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the user id, route, or authenticated user identity changes.
	useEffect(() => {
		if (!session || !isDetailRoute || isPermissionPending || !isAuthorized) {
			return;
		}

		async function load() {
			setError(null);
			try {
				const api = getTreaty();
				const data = await unwrap<AdminUserDetail>(
					await api.admin.users({ id }).get(),
				);
				setUserData(data);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, isDetailRoute, isAuthorized, isPermissionPending, session?.user.id]);

	if (!isDetailRoute) {
		return <Outlet />;
	}

	if (isPending || isPermissionPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	if (error) {
		return (
			<div className="mx-auto w-full max-w-5xl">
				<Notice tone="error">{t(error)}</Notice>
			</div>
		);
	}

	if (!userData) {
		return (
			<div className="mx-auto w-full max-w-5xl">
				<Card>{t("loading.dashboard")}</Card>
			</div>
		);
	}

	const canEdit = hasPermission("users.write");
	const canDelete = hasPermission("users.delete");

	return (
		<div className="mx-auto grid w-full max-w-5xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<Link
							className="text-sm font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
							to="/admin/access/users"
						>
							{t("users.viewAll")}
						</Link>
						<h1 className="mt-4 text-4xl font-medium tracking-tight">
							{userData.name}
						</h1>
						<p className="mt-2 text-muted-foreground">{userData.email}</p>
					</div>
					{canEdit ? (
						<Link
							params={{ id: userData.id }}
							to="/admin/access/users/$id/edit"
						>
							<Button type="button">{t("forms.update")}</Button>
						</Link>
					) : null}
				</div>
			</Card>

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<DetailCard
					label={t("forms.active")}
					value={
						userData.isActive ? t("domains.active") : t("domains.inactive")
					}
				/>
				<DetailCard label={t("forms.email")} value={userData.email} />
				<DetailCard
					label={t("users.emailVerified")}
					value={
						userData.emailVerified ? t("domains.active") : t("domains.inactive")
					}
				/>
				<DetailCard
					label={t("users.role")}
					value={
						userData.roleIsSystem && userData.roleName
							? `${userData.roleName} · ${t("roles.systemBadge")}`
							: (userData.roleName ?? "—")
					}
				/>
				<DetailCard label={t("forms.locale")} value={userData.locale} />
				{userData.invitedByName ? (
					<DetailCard
						label={t("users.invitedBy")}
						value={`${userData.invitedByName} (${userData.invitedByEmail})`}
					/>
				) : null}
				<DetailCard
					label={t("users.created")}
					value={new Date(userData.createdAt).toLocaleDateString(locale)}
				/>
				<DetailCard
					label={t("users.updated")}
					value={new Date(userData.updatedAt).toLocaleDateString(locale)}
				/>
			</section>

			<div className="flex flex-wrap gap-3">
				{canEdit ? (
					<Button
						onClick={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(
									await api.admin.users({ id: userData.id }).patch({
										isActive: !userData.isActive,
									}),
								);
								setUserData({ ...userData, isActive: !userData.isActive });
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
						{userData.isActive ? t("users.disable") : t("users.enable")}
					</Button>
				) : null}
				{canDelete ? (
					<DeleteConfirmationDialog
						title={t("forms.confirmDelete")}
						description={t("forms.confirmDeleteDescription")}
						confirmLabel={t("forms.delete")}
						cancelLabel={t("forms.cancel")}
						onConfirm={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(
									await api.admin.users({ id: userData.id }).delete(),
								);
								await router.navigate({ to: "/admin/access/users" });
							} catch (nextError) {
								setError(
									nextError instanceof Error
										? nextError.message
										: "errors.unknown",
								);
							}
						}}
					>
						<Button tone="danger" type="button">
							{t("users.delete")}
						</Button>
					</DeleteConfirmationDialog>
				) : null}
			</div>

			{error ? <Notice tone="error">{t(error)}</Notice> : null}
		</div>
	);
}

function DetailCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
				{label}
			</p>
			<p className="mt-2 text-lg font-medium text-foreground">{value}</p>
		</Card>
	);
}
