import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";

type ConsentSearch = {
	client_id?: string;
	scope?: string;
};

type ConsentPrompt = {
	clientId: string;
	clientName: string;
	scopes: string[];
};

function validateConsentSearch(search: Record<string, unknown>): ConsentSearch {
	return {
		client_id: typeof search.client_id === "string" ? search.client_id : "",
		scope: typeof search.scope === "string" ? search.scope : "",
	};
}

export const Route = createFileRoute("/admin/mcp/consent")({
	component: McpConsentPage,
	validateSearch: validateConsentSearch,
});

function McpConsentPage() {
	const { session, isPending, t } = useAdminAuthGuard();
	const router = useRouter();
	const { client_id: clientId = "", scope = "" } = Route.useSearch();
	const [prompt, setPrompt] = useState<ConsentPrompt | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!session || !clientId) {
			setPrompt(null);
			return;
		}

		let cancelled = false;
		setError(null);
		void unwrap<ConsentPrompt>(
			getTreaty().admin.mcp.consent.get({
				query: { client_id: clientId, scope },
			}),
		)
			.then((next) => {
				if (!cancelled) {
					setPrompt(next);
				}
			})
			.catch((nextError: unknown) => {
				if (!cancelled) {
					setPrompt(null);
					setError(
						nextError instanceof Error ? nextError.message : "errors.unknown",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [clientId, scope, session]);

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
				{prompt ? (
					<>
						<p className="text-sm text-muted-foreground">
							{t("mcp.consentClient")}{" "}
							<span className="font-mono text-foreground">
								{prompt.clientName}
							</span>
						</p>
						{prompt.scopes.length > 0 ? (
							<p className="mt-2 text-sm text-muted-foreground">
								{t("mcp.consentScopes")}{" "}
								<span className="font-mono text-foreground">
									{prompt.scopes.join(" ")}
								</span>
							</p>
						) : null}
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("loading.dashboard")}
					</p>
				)}
				<div className="mt-6 flex flex-wrap gap-3">
					<Button
						disabled={busy || !prompt}
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
