import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminSession } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/sessions")({
	component: Sessions,
});

function Sessions() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("sessions.manage");
	const [sessions, setSessions] = useState<AdminSession[]>([]);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		try {
			setError(null);
			const api = getTreaty();
			setSessions(await unwrap<AdminSession[]>(await api.admin.sessions.get()));
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable within this component; re-fetch only when the authenticated user identity changes.
	useEffect(() => {
		if (session) {
			void refresh();
		}
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
		<div className="mx-auto w-full max-w-5xl">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
					<div>
						<Link
							className="text-sm font-bold text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
							to="/admin/profile"
						>
							{t("nav.profile")}
						</Link>
						<h1 className="mt-4 text-4xl font-medium">{t("sessions.title")}</h1>
						<p className="mt-2 text-muted-foreground">
							{t("sessions.description")}
						</p>
					</div>
					<Button
						onClick={async () => {
							try {
								setError(null);
								const api = getTreaty();
								await unwrap(await api.admin.sessions["revoke-other"].post());
								await refresh();
							} catch (nextError) {
								setError(
									nextError instanceof Error
										? nextError.message
										: "errors.unknown",
								);
							}
						}}
						tone="secondary"
						type="button"
					>
						{t("sessions.revokeOther")}
					</Button>
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				<div className="mt-6 grid gap-3">
					{sessions.length ? (
						sessions.map((item) => (
							<div
								className="rounded-md border border-border bg-card/60 p-4"
								key={item.token}
							>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div>
										<p className="font-medium">
											{item.userAgent ?? t("sessions.unknownBrowser")}
										</p>
										<p className="mt-1 text-sm text-muted-foreground">
											{t("sessions.ip")}{" "}
											{item.ipAddress ?? t("sessions.unknown")} ·{" "}
											{t("sessions.expires")}{" "}
											{item.expiresAt
												? new Date(item.expiresAt).toLocaleString(locale)
												: t("sessions.unknown")}
										</p>
									</div>
									<Button
										onClick={async () => {
											try {
												setError(null);
												const api = getTreaty();
												await unwrap(
													await api.admin.sessions.revoke.post({
														token: item.token,
													}),
												);
												await refresh();
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
										{t("sessions.revoke")}
									</Button>
								</div>
							</div>
						))
					) : (
						<p className="rounded-md border border-border bg-card/60 p-4 text-sm text-muted-foreground">
							{t("sessions.empty")}
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}
