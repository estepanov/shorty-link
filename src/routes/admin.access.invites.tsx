import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import {
	Button,
	Card,
	DataRow,
	DeleteConfirmationDialog,
	EmptyState,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AdminInvite, InviteListData } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/invites")({
	component: InvitesTab,
});

type InviteFilters = {
	pageSize: number;
	search: string;
	status: "all" | "pending" | "expired" | "accepted";
};

const defaultFilters: InviteFilters = {
	pageSize: 25,
	search: "",
	status: "all",
};

function InvitesTab() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const [data, setData] = useState<InviteListData | null>(null);
	const [filters, setFilters] = useState<InviteFilters>(defaultFilters);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => {
			setFilters(value);
			setPage(1);
		},
	});

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const nextData = await unwrap<InviteListData>(
				await api.admin.invites.get({
					query: {
						page,
						pageSize: filters.pageSize,
						search: filters.search,
						status: filters.status,
					},
				}),
			);
			setData(nextData);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session identity or filters change.
	useEffect(() => {
		if (session) {
			void refresh();
		}
	}, [session?.user.id, filters, page]);

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!hasPermission("invites.read")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const firstItem =
		data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
	const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

	return (
		<div className="grid gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
					<h2 className="text-2xl font-medium">{t("users.invites")}</h2>
					{hasPermission("invites.create") ? (
						<Link
							className="inline-flex items-center justify-center rounded-md border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
							to="/admin/invites/new"
						>
							{t("access.createInvite")}
						</Link>
					) : null}
				</div>

				<form
					className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="search">
						{(field) => (
							<FieldLabel>
								{t("users.search")}
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="status">
						{(field) => (
							<FieldLabel>
								{t("forms.active")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as InviteFilters["status"])
									}
									value={field.state.value}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("users.statusAll")}</SelectItem>
										<SelectItem value="pending">
											{t("users.statusPending")}
										</SelectItem>
										<SelectItem value="accepted">
											{t("users.statusAccepted")}
										</SelectItem>
										<SelectItem value="expired">
											{t("users.statusExpired")}
										</SelectItem>
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="pageSize">
						{(field) => (
							<FieldLabel>
								{t("links.pageSize")}
								<Select
									onValueChange={(val) => field.handleChange(Number(val))}
									value={String(field.state.value)}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[10, 25, 50, 100].map((size) => (
											<SelectItem key={size} value={String(size)}>
												{size}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<div className="flex items-end gap-2">
						<Button type="submit">{t("forms.apply")}</Button>
						<Button
							onClick={() => {
								form.reset(defaultFilters);
								setFilters(defaultFilters);
								setPage(1);
							}}
							tone="secondary"
							type="button"
						>
							{t("forms.reset")}
						</Button>
					</div>
				</form>

				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
			</Card>

			<Card>
				<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
					<p className="text-sm font-bold text-muted-foreground">
						{t("users.showing")} {firstItem}-{lastItem} {t("users.of")}{" "}
						{data?.total ?? 0}
					</p>
					<div className="flex gap-2">
						<Button
							disabled={!data || data.page <= 1}
							onClick={() => setPage((value) => Math.max(1, value - 1))}
							tone="secondary"
							type="button"
						>
							{t("users.previous")}
						</Button>
						<Button
							disabled={!data || data.page >= data.totalPages}
							onClick={() =>
								setPage((value) =>
									Math.min(data?.totalPages ?? value, value + 1),
								)
							}
							tone="secondary"
							type="button"
						>
							{t("users.next")}
						</Button>
					</div>
				</div>

				<div className="mt-5 grid gap-3">
					{data?.items.length ? (
						data.items.map((invite) => (
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
											<span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
												{invite.roleName}
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
										{invite.invitedByName ? (
											<p className="mt-1 text-xs text-muted-foreground">
												{t("users.invitedBy")} {invite.invitedByName}
											</p>
										) : null}
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
									{hasPermission("invites.delete") ? (
										<div className="flex shrink-0 items-center gap-2">
											<DeleteConfirmationDialog
												title={t("forms.confirmDelete")}
												description={t("forms.confirmDeleteDescription")}
												confirmLabel={t("users.cancelInvite")}
												cancelLabel={t("forms.cancel")}
												onConfirm={async () => {
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
											>
												<Button tone="danger" type="button">
													{t("users.cancelInvite")}
												</Button>
											</DeleteConfirmationDialog>
										</div>
									) : null}
								</div>
							</DataRow>
						))
					) : (
						<EmptyState description={t("users.emptyInvites")} />
					)}
				</div>
			</Card>
		</div>
	);
}
