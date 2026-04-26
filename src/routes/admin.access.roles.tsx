import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DataRow,
	DeleteConfirmationDialog,
	Notice,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AdminRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/roles")({
	component: RolesTab,
});

function RolesTab() {
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const [roles, setRoles] = useState<AdminRole[]>([]);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const nextRoles = await unwrap<AdminRole[]>(await api.admin.roles.get());
			setRoles(nextRoles);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

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

	if (!hasPermission("roles.manage")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	async function deleteRole(roleId: string) {
		setError(null);
		try {
			const api = getTreaty();
			await unwrap(await api.admin.roles({ id: roleId }).delete());
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	return (
		<div className="grid gap-6">
			<Card>
				<p className="text-sm text-muted-foreground">
					{t("roles.description")}
				</p>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				<div className="mt-4">
					<Link to="/admin/roles/new">
						<Button type="button">{t("roles.create")}</Button>
					</Link>
				</div>
			</Card>

			<Card>
				<div className="grid gap-3">
					{roles.length ? (
						roles.map((role) => (
							<DataRow key={role.id}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="flex-1">
										<p className="font-medium">
											<Link
												className="text-accent underline underline-offset-4 dark:text-accent"
												params={{ id: role.id }}
												to="/admin/roles/$id/edit"
											>
												{role.name}
											</Link>
											{role.isSystem ? (
												<span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
													{t("roles.systemBadge")}
												</span>
											) : null}
										</p>
										{role.description ? (
											<p className="mt-1 text-sm text-muted-foreground">
												{role.description}
											</p>
										) : null}
										<p className="mt-2 text-xs text-muted-foreground/80">
											{t("roles.permissionsCount").replace(
												"{{count}}",
												String(role.permissions.length),
											)}{" "}
											·{" "}
											{role.domainScopeCount === 0 && role.linkScopeCount === 0
												? t("roles.unrestricted")
												: `${t("roles.scopeDomains")}: ${role.domainScopeCount}, ${t("roles.scopeLinks")}: ${role.linkScopeCount}`}{" "}
											·{" "}
											{t("roles.usersCount").replace(
												"{{count}}",
												String(role.userCount),
											)}
										</p>
									</div>
									<div className="flex gap-2">
										{!role.isSystem && (
											<Link params={{ id: role.id }} to="/admin/roles/$id/edit">
												<Button tone="secondary" type="button">
													{t("roles.edit")}
												</Button>
											</Link>
										)}
										<DeleteConfirmationDialog
											title={t("forms.confirmDelete")}
											description={t("forms.confirmDeleteDescription")}
											confirmLabel={t("forms.delete")}
											cancelLabel={t("forms.cancel")}
											onConfirm={() => deleteRole(role.id)}
										>
											<Button
												disabled={role.isSystem || role.userCount > 0}
												tone="danger"
												type="button"
											>
												{t("roles.delete")}
											</Button>
										</DeleteConfirmationDialog>
									</div>
								</div>
							</DataRow>
						))
					) : (
						<p className="text-sm text-muted-foreground">{t("roles.empty")}</p>
					)}
				</div>
			</Card>
		</div>
	);
}
