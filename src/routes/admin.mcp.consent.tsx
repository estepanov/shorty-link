import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/admin/mcp/consent")({
	component: McpConsentPage,
});

function McpConsentPage() {
	const { session, isPending, t } = useAdminAuthGuard();
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const params = useMemo(() => {
		if (typeof window === "undefined") {
			return { clientId: "", consentCode: "", scope: "" };
		}
		const search = new URLSearchParams(window.location.search);
		return {
			clientId: search.get("client_id") ?? "",
			consentCode: search.get("consent_code") ?? "",
			scope: search.get("scope") ?? "",
		};
	}, []);

	if (isPending) {
		return (
			<div className="mx-auto grid w-full max-w-3xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto grid w-full max-w-3xl gap-6">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	async function decide(accept: boolean) {
		try {
			setBusy(true);
			setError(null);
			const result = await authClient.oauth2.consent({
				accept,
				consent_code: params.consentCode || undefined,
			});
			if (result.error) {
				throw new Error(
					typeof result.error === "object" &&
						result.error &&
						"message" in result.error &&
						typeof result.error.message === "string"
						? result.error.message
						: "errors.unknown",
				);
			}
			const data = result.data as { redirect?: string; url?: string } | null;
			const redirectTo = data?.redirect ?? data?.url;
			if (redirectTo) {
				window.location.assign(redirectTo);
				return;
			}
			await router.navigate({ to: "/admin/user/mcp" });
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto grid w-full max-w-3xl gap-6">
			<PageHeader
				title={t("mcp.consentTitle")}
				description={t("mcp.consentDescription")}
			/>
			<Card>
				{error ? (
					<div className="mb-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				<p className="text-sm text-muted-foreground">
					{t("mcp.consentClient")}{" "}
					<span className="font-mono text-foreground">
						{params.clientId || t("mcp.unknownClient")}
					</span>
				</p>
				{params.scope ? (
					<p className="mt-2 text-sm text-muted-foreground">
						{t("mcp.consentScopes")}{" "}
						<span className="font-mono text-foreground">{params.scope}</span>
					</p>
				) : null}
				<div className="mt-6 flex flex-wrap gap-3">
					<Button
						disabled={busy}
						onClick={() => void decide(true)}
						type="button"
					>
						{t("mcp.consentAllow")}
					</Button>
					<Button
						disabled={busy}
						onClick={() => void decide(false)}
						tone="secondary"
						type="button"
					>
						{t("mcp.consentDeny")}
					</Button>
				</div>
			</Card>
		</div>
	);
}
