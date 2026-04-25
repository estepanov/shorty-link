import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
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
	const { isAuthorized } = useRequirePermission("links.write");
	const [domains, setDomains] = useState<AdminDomain[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the authenticated user identity changes.
	useEffect(() => {
		if (!session) {
			return;
		}

		async function loadDomains() {
			setError(null);
			try {
				const api = getTreaty();
				setDomains(await unwrap<AdminDomain[]>(await api.admin.domains.get()));
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void loadDomains();
	}, [session?.user.id]);

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
				<Link
					className="text-sm font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
					to="/admin"
				>
					{t("pages.backDashboard")}
				</Link>
				<h1 className="mt-4 text-4xl font-medium">{t("pages.newLink")}</h1>
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
