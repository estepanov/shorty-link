import {
	createFileRoute,
	Navigate,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { Card } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";

export const Route = createFileRoute("/admin/user")({
	component: UserLayout,
});

function UserLayout() {
	const { session, isPending, t } = useAdminAuthGuard();
	const location = useLocation();
	const currentPath = location.pathname;

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

	if (currentPath === "/admin/user" || currentPath === "/admin/user/") {
		return <Navigate to="/admin/user/profile" />;
	}

	return <Outlet />;
}
