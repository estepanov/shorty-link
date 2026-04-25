import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { Button, Card, Notice } from "@/components/ui";
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
					<h2 className="text-2xl font-black">{t("users.invites")}</h2>
					{hasPermission("invites.manage") ? (
						<Link
							className="inline-flex items-center justify-center rounded-2xl border border-stone-950 bg-stone-950 px-4 py-3 text-sm font-black text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:border-white dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
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
							<div
								className="flex items-start justify-between gap-3 rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
								key={invite.id}
							>
								<div>
									<p className="font-black">{invite.email}</p>
									<p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
										<span
											className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
												invite.status === "pending"
													? "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100"
													: invite.status === "accepted"
														? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100"
														: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
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
												? new Date(invite.acceptedAt).toLocaleDateString(locale)
												: `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleDateString(locale)}`}
									</p>
									{invite.inviteUrl ? (
										<div className="mt-1 flex items-center gap-2">
											<a
												className="break-all text-xs text-blue-800 underline dark:text-blue-300"
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
						))
					) : (
						<p className="text-sm text-stone-600 dark:text-stone-300">
							{t("users.emptyInvites")}
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}
