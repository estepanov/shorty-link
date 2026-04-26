import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { Button, Card, DataRow, Notice } from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AdminInvite } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/invites")({
	component: InvitesTab,
});

type InviteWithStatus = AdminInvite & {
	status: "pending" | "expired" | "accepted";
};

function InvitesTab() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const [invites, setInvites] = useState<AdminInvite[]>([]);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const nextInvites = await unwrap<AdminInvite[]>(
				await api.admin.invites.get(),
			);
			setInvites(nextInvites);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session identity changes.
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

	if (!hasPermission("invites.manage")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const now = Date.now();

	const invitesWithStatus: InviteWithStatus[] = invites.map((invite) => {
		if (invite.acceptedAt) return { ...invite, status: "accepted" };
		if (invite.expiresAt < now) return { ...invite, status: "expired" };
		return { ...invite, status: "pending" };
	});

	return (
		<div className="grid gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
					<h2 className="text-2xl font-medium">{t("users.invites")}</h2>
					{hasPermission("invites.manage") ? (
						<Link
							className="inline-flex items-center justify-center rounded-md border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
							to="/admin/invites/new"
						>
							{t("access.createInvite")}
						</Link>
					) : null}
				</div>

				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}

				<div className="mt-5 grid gap-3">
					{invitesWithStatus.length ? (
						invitesWithStatus.map((invite) => (
							<DataRow key={invite.id}>
								<div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
									<div className="min-w-0 flex-1">
										<p className="font-medium">{invite.email}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											<span
												className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
													invite.status === "pending"
														? "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100"
														: invite.status === "accepted"
															? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100"
															: "bg-muted text-muted-foreground"
												}`}
											>
												{t(
													`users.status${invite.status.charAt(0).toUpperCase() + invite.status.slice(1)}`,
												)}
											</span>
											{" · "}
											{invite.status === "pending"
												? `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleDateString(locale)}`
												: invite.status === "accepted" && invite.acceptedAt
													? new Date(invite.acceptedAt).toLocaleDateString(
															locale,
														)
													: `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleDateString(locale)}`}
										</p>
										{invite.inviteUrl ? (
											<div className="mt-1 flex items-center gap-2">
												<a
													className="break-all text-xs text-accent underline dark:text-accent"
													href={invite.inviteUrl}
												>
													{invite.inviteUrl}
												</a>
												<CopyButton
													className="shrink-0 !rounded-xl !px-2 !py-2"
													copiedLabel={t("actions.copied")}
													label={t("actions.copyLink")}
													text={invite.inviteUrl}
												/>
											</div>
										) : null}
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<Button
											onClick={async () => {
												setError(null);
												try {
													const api = getTreaty();
													await unwrap(
														await api.admin.invites.delete({
															id: invite.id,
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
											{t("users.cancelInvite")}
										</Button>
									</div>
								</div>
							</DataRow>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							{t("users.emptyInvites")}
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}
