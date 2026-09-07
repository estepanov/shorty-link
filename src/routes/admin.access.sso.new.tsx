import { createFileRoute, useRouter } from "@tanstack/react-router";

import { SsoProviderForm } from "@/components/sso-provider-form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";

export const Route = createFileRoute("/admin/access/sso/new")({
	component: NewSsoProvider,
});

function NewSsoProvider() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("sso.write");
	const router = useRouter();

	if (isPending || isAuthPending) {
		return <Card>{t("loading.app")}</Card>;
	}
	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}
	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<div className="grid gap-6">
			<PageHeader title={t("sso.add")} />
			<SsoProviderForm
				mode="create"
				onSaved={() => {
					void router.navigate({ to: "/admin/access/sso" });
				}}
				t={t}
			/>
		</div>
	);
}
