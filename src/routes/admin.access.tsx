import {
	createFileRoute,
	Link,
	Navigate,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { Card } from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/access")({
	component: AccessLayout,
});

const allTabs: Array<{
	path: string;
	labelKey: "access.tabs.users" | "access.tabs.invites" | "access.tabs.roles";
	permission: Permission;
}> = [
	{
		path: "/admin/access/users",
		labelKey: "access.tabs.users",
		permission: "users.read" as Permission,
	},
	{
		path: "/admin/access/invites",
		labelKey: "access.tabs.invites",
		permission: "invites.manage" as Permission,
	},
	{
		path: "/admin/access/roles",
		labelKey: "access.tabs.roles",
		permission: "roles.manage" as Permission,
	},
];

function AccessLayout() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const location = useLocation();
	const currentPath = location.pathname;

	const visibleTabs = allTabs.filter((tab) =>
		tab.permission ? hasPermission(tab.permission) : true,
	);

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
				<Card>{t("errors.unauthorized")}</Card>
			</div>
		);
	}

	if (visibleTabs.length === 0) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("errors.permissionDenied")}</Card>
			</div>
		);
	}

	if (currentPath === "/admin/access" || currentPath === "/admin/access/") {
		return <Navigate to={visibleTabs[0].path} />;
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<Link
					className="text-sm font-medium text-accent underline underline-offset-4 dark:text-accent"
					to="/admin"
				>
					{t("pages.backDashboard")}
				</Link>
				<h1 className="mt-4 text-4xl font-medium">{t("nav.access")}</h1>
			</Card>

			<div className="flex gap-1 rounded-md border border-foreground/10 bg-card/60 p-1 ">
				{visibleTabs.map((tab) => {
					const isActive = currentPath === tab.path;
					return (
						<Link
							className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
								isActive
									? "bg-foreground text-white dark:bg-card dark:text-foreground"
									: "text-muted-foreground hover:bg-muted dark:hover:bg-muted"
							}`}
							key={tab.path}
							to={tab.path}
						>
							{t(tab.labelKey)}
						</Link>
					);
				})}
			</div>

			<Outlet />
		</div>
	);
}
