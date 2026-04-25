import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { DomainForm } from "@/components/admin-forms";
import { Button, Card, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminDomain } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/domains/$id/edit")({
	component: EditDomain,
});

function EditDomain() {
	const { id } = Route.useParams();
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("domains.write");
	const [domain, setDomain] = useState<AdminDomain | null>(null);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the domain id or authenticated user identity changes.
	useEffect(() => {
		if (!session) {
			return;
		}

		async function loadDomain() {
			setError(null);
			try {
				const api = getTreaty();
				setDomain(
					await unwrap<AdminDomain>(await api.admin.domains({ id }).get()),
				);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void loadDomain();
	}, [id, session?.user.id]);

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
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<h1 className="text-4xl font-medium">{t("pages.editDomain")}</h1>
					<Button
						onClick={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(await api.admin.domains({ id }).delete());
								await router.navigate({ to: "/admin/domains" });
							} catch (nextError) {
								setError(
									nextError instanceof Error
										? nextError.message
										: "errors.unknown",
								);
							}
						}}
						tone="danger"
						type="button"
					>
						{t("forms.delete")}
					</Button>
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{domain ? (
					<DomainForm
						initialDomain={domain}
						onSaved={() => {
							void router.navigate({ to: "/admin/domains" });
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
