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
		<div className="mx-auto w-full max-w-4xl animate-fade-up">
			<Card className="p-5 sm:p-7">
				<div className="flex flex-col gap-2 border-b border-border/70 pb-5">
					<p className="eyebrow">{t("nav.domains")}</p>
					<h1 className="text-3xl font-medium sm:text-4xl">
						{t("pages.newDomain")}
					</h1>
				</div>
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
