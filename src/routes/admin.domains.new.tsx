import { createFileRoute, useRouter } from "@tanstack/react-router";

import { DomainForm } from "@/components/admin-forms";
import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";

export const Route = createFileRoute("/admin/domains/new")({
	component: NewDomain,
});

function NewDomain() {
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("domains.write");

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<h1 className="text-4xl font-medium">{t("pages.newDomain")}</h1>
				<DomainForm
					onSaved={() => {
						void router.navigate({ to: "/admin" });
					}}
					t={t}
				/>
			</Card>
		</div>
	);
}
