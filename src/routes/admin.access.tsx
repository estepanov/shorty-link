import {
	createFileRoute,
	Navigate,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { Card, PageHeader, type TabItem, Tabs } from "@/components/ui";
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
		permission: "invites.read" as Permission,
	},
	{
		path: "/admin/access/roles",
		labelKey: "access.tabs.roles",
		permission: "roles.read" as Permission,
	},
];

function AccessLayout() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const location = useLocation();
	const currentPath = location.pathname;

	const visibleTabs = allTabs.filter((tab) => hasPermission(tab.permission));

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

	const tabItems: TabItem[] = visibleTabs.map((tab) => ({
		to: tab.path,
		label: t(tab.labelKey),
		exact: true,
	}));

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<PageHeader title={t("nav.access")} />
			<Tabs ariaLabel={t("nav.access")} items={tabItems} />
			<Outlet />
		</div>
	);
}
