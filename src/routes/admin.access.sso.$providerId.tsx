import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SsoProviderForm } from "@/components/sso-provider-form";
import { ssoProviderToFormValues } from "@/components/sso-provider-form-codec";
import { Card, Notice, PageHeader } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";
import type { SsoProviderRead } from "@/lib/sso-types";

export const Route = createFileRoute("/admin/access/sso/$providerId")({
	component: EditSsoProvider,
});

function EditSsoProvider() {
	const { providerId } = Route.useParams();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("sso.write");
	const router = useRouter();
	const [provider, setProvider] = useState<SsoProviderRead | null>(null);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session or provider id changes.
	useEffect(() => {
		if (!session) {
			return;
		}
		void unwrap(getTreaty().admin["sso-providers"]({ providerId }).get()).then(
			setProvider,
			(nextError: unknown) => {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			},
		);
	}, [providerId, session?.user.id]);

	if (isPending || isAuthPending || !provider) {
		return <Card>{error ? t(error) : t("loading.app")}</Card>;
	}
	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}
	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<div className="grid gap-6">
			<PageHeader title={provider.displayName} />
			<SsoProviderForm
				acsUrl={provider.acsUrl}
				callbackUrl={provider.callbackUrl}
				initialValues={ssoProviderToFormValues(provider)}
				mode="edit"
				onSaved={() => {
					void router.navigate({ to: "/admin/access/sso" });
				}}
				t={t}
			/>
		</div>
	);
}
