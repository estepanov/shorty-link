import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DeleteConfirmationDialog,
	EmptyState,
	Notice,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/sso")({
	component: SsoTab,
});

type SsoProviderRow = {
	providerId: string;
	displayName: string;
	protocol: "oidc" | "saml";
	domains: string[];
	enabled: boolean;
	enforceSso: boolean;
	jitEnabled: boolean;
};

function SsoTab() {
	const location = useLocation();
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const isListRoute =
		location.pathname === "/admin/access/sso" ||
		location.pathname === "/admin/access/sso/";
	const [providers, setProviders] = useState<SsoProviderRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const next = await unwrap<SsoProviderRow[]>(
				await getTreaty().admin["sso-providers"].get(),
			);
			setProviders(next);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable; refetch when the list route or authenticated user identity changes.
	useEffect(() => {
		if (!session || !isListRoute) {
			return;
		}
		void refresh();
	}, [isListRoute, session?.user.id]);

	if (!isListRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	return (
		<div className="grid gap-4">
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<div className="flex justify-end">
				{hasPermission("sso.write") ? (
					<Link to="/admin/access/sso/new">
						<Button type="button">{t("sso.add")}</Button>
					</Link>
				) : null}
			</div>
			{providers?.length ? (
				<div className="grid gap-3">
					{providers.map((provider) => (
						<Card key={provider.providerId} className="grid gap-2 p-4">
							<div className="flex items-center justify-between gap-4">
								<div>
									<p className="font-medium">{provider.displayName}</p>
									<p className="text-muted-foreground text-sm">
										{provider.providerId} · {provider.protocol} ·{" "}
										{provider.domains.join(", ")}
									</p>
								</div>
								<div className="flex gap-2">
									{hasPermission("sso.write") ? (
										<Link
											params={{ providerId: provider.providerId }}
											to="/admin/access/sso/$providerId"
										>
											<Button tone="secondary" type="button">
												{t("sso.edit")}
											</Button>
										</Link>
									) : null}
									{hasPermission("sso.delete") ? (
										<DeleteConfirmationDialog
											cancelLabel={t("forms.cancel")}
											confirmLabel={t("forms.delete")}
											onConfirm={async () => {
												await unwrap(
													await getTreaty()
														.admin["sso-providers"]({
															providerId: provider.providerId,
														})
														.delete(),
												);
												await refresh();
											}}
											title={t("sso.delete")}
										>
											<Button tone="danger" type="button">
												{t("forms.delete")}
											</Button>
										</DeleteConfirmationDialog>
									) : null}
								</div>
							</div>
							<p className="text-muted-foreground text-sm">
								{provider.enabled ? t("sso.enabled") : t("sso.disabled")}
								{provider.enforceSso ? ` · ${t("sso.enforceSso")}` : ""}
								{provider.jitEnabled ? ` · ${t("sso.jitEnabled")}` : ""}
							</p>
						</Card>
					))}
				</div>
			) : (
				<EmptyState description={t("sso.empty")} />
			)}
		</div>
	);
}
