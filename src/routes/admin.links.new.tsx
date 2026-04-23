import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LinkForm } from "@/components/admin-forms";
import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type { AdminDomain } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/links/new")({
	component: NewLink,
});

function NewLink() {
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
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

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<Link
					className="text-sm font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
					to="/admin"
				>
					{t("pages.backDashboard")}
				</Link>
				<h1 className="mt-4 text-4xl font-black">{t("pages.newLink")}</h1>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{domains ? (
					<LinkForm
						domains={domains}
						onSaved={() => {
							void router.navigate({ to: "/admin" });
						}}
						t={t}
					/>
				) : (
					<p className="mt-6 text-stone-600 dark:text-stone-300">
						{t("loading.dashboard")}
					</p>
				)}
			</Card>
		</div>
	);
}
