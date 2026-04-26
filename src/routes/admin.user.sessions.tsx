import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AccountTabs } from "@/components/account-tabs";
import {
	Button,
	Card,
	DataRow,
	EmptyState,
	Notice,
	PageHeader,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminSession } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/user/sessions")({
	component: Sessions,
});

function Sessions() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("sessions.manage");
	const [sessions, setSessions] = useState<AdminSession[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

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
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	if (!isAuthorized) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.permissionDenied")}</Notice>
			</div>
		);
	}

	async function revokeOther() {
		try {
			setBusy(true);
			setError(null);
			const api = getTreaty();
			await unwrap(await api.admin.sessions["revoke-other"].post());
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		} finally {
			setBusy(false);
		}
	}

	async function revoke(token: string) {
		try {
			setError(null);
			const api = getTreaty();
			await unwrap(await api.admin.sessions.revoke.post({ token }));
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<PageHeader
				title={t("sessions.title")}
				description={t("sessions.description")}
				actions={
					<Button
						disabled={busy || sessions.length <= 1}
						onClick={revokeOther}
						tone="secondary"
						type="button"
					>
						{t("sessions.revokeOther")}
					</Button>
				}
			/>
			<AccountTabs locale={locale} />

			<Card>
				{error ? (
					<div className="mb-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				<div className="grid gap-3">
					{sessions.length ? (
						sessions.map((item) => (
							<DataRow key={item.token}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="min-w-0">
										<p className="font-medium">
											{item.userAgent ?? t("sessions.unknownBrowser")}
										</p>
										<p className="mt-1 text-sm text-muted-foreground">
											<span className="font-mono">
												{item.ipAddress ?? t("sessions.unknown")}
											</span>{" "}
											· {t("sessions.expires")}{" "}
											{item.expiresAt
												? new Date(item.expiresAt).toLocaleString(locale)
												: t("sessions.unknown")}
										</p>
									</div>
									<Button
										onClick={() => revoke(item.token)}
										size="sm"
										tone="danger"
										type="button"
									>
										{t("sessions.revoke")}
									</Button>
								</div>
							</DataRow>
						))
					) : (
						<EmptyState description={t("sessions.empty")} />
					)}
				</div>
			</Card>
		</div>
	);
}
