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
					className="text-sm font-black text-blue-800 underline underline-offset-4 dark:text-blue-300"
					to="/admin"
				>
					{t("pages.backDashboard")}
				</Link>
				<h1 className="mt-4 text-4xl font-black">{t("nav.access")}</h1>
			</Card>

			<div className="flex gap-1 rounded-2xl border border-stone-950/10 bg-white/70 p-1 dark:border-white/10 dark:bg-white/5">
				{visibleTabs.map((tab) => {
					const isActive = currentPath === tab.path;
					return (
						<Link
							className={`rounded-xl px-4 py-2 text-sm font-black transition ${
								isActive
									? "bg-stone-950 text-white dark:bg-white dark:text-stone-950"
									: "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
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
