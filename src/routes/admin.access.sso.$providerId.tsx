import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SsoProviderForm } from "@/components/sso-provider-form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";
import type { SsoProviderRead } from "@/lib/sso-types";

export const Route = createFileRoute("/admin/access/sso/$providerId")({
	component: EditSsoProvider,
});

function readConfigString(
	config: Record<string, unknown> | null,
	path: readonly string[],
) {
	let current: unknown = config;
	for (const key of path) {
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			return "";
		}
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : "";
}

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
		void unwrap<SsoProviderRead>(
			getTreaty().admin["sso-providers"]({ providerId }).get(),
		).then(setProvider, (nextError: unknown) => {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		});
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
				initialValues={{
					allowIdpInitiated: provider.allowIdpInitiated,
					clientId: readConfigString(provider.oidcConfig, ["clientId"]),
					defaultRoleId: provider.defaultRoleId ?? "",
					displayName: provider.displayName,
					domain: provider.domains.join(","),
					enabled: provider.enabled,
					enforceSso: provider.enforceSso,
					groupClaim: provider.groupClaim,
					groupRoleMappings: provider.groupRoleMappings
						.map((mapping) => `${mapping.group}=${mapping.roleId}`)
						.join("\n"),
					idpMetadata: readConfigString(provider.samlConfig, [
						"idpMetadata",
						"metadata",
					]),
					issuer: provider.issuer,
					jitEnabled: provider.jitEnabled,
					protocol: provider.protocol,
					providerId: provider.providerId,
				}}
				mode="edit"
				onSaved={() => {
					void router.navigate({ to: "/admin/access/sso" });
				}}
				t={t}
			/>
		</div>
	);
}
