import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LinkForm } from "@/components/admin-forms";
import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminDomain } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/links/new")({
	component: NewLink,
});

function NewLink() {
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const {
		hasPermission,
		isAuthorized,
		isPending: isPermissionPending,
	} = useRequirePermission("links.write");
	const [domains, setDomains] = useState<AdminDomain[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const canViewDomains = hasPermission("domains.read");

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the authenticated user identity changes.
	useEffect(() => {
		if (!session || isPermissionPending || !isAuthorized) {
			return;
		}

		async function loadDomains() {
			setError(null);
			try {
				if (!canViewDomains) {
					setDomains([]);
					return;
				}
				const api = getTreaty();
				setDomains(await unwrap<AdminDomain[]>(await api.admin.domains.get()));
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void loadDomains();
	}, [canViewDomains, isAuthorized, isPermissionPending, session?.user.id]);

	if (isPending || isPermissionPending) {
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
				<h1 className="text-4xl font-medium">{t("pages.newLink")}</h1>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{domains ? (
					<LinkForm
						domains={domains}
						onSaved={() => {
							void router.navigate({ to: "/admin/links" });
						}}
						t={t}
					/>
				) : (
					<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
				)}
			</Card>
		</div>
	);
}
