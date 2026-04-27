import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { DataPagination } from "@/components/data-pagination";
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
import type { InviteListData } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

type InviteStatus = "all" | "pending" | "expired" | "accepted";

type InviteSearch = {
	page?: number;
	pageSize?: number;
	search?: string;
	status?: Exclude<InviteStatus, "all">;
};

const inviteStatusValues: InviteStatus[] = [
	"all",
	"pending",
	"expired",
	"accepted",
];

function validateInvitesSearch(search: Record<string, unknown>): InviteSearch {
	const out: InviteSearch = {};
	const pageRaw = Number(search.page);
	if (Number.isFinite(pageRaw) && pageRaw > 1) out.page = Math.floor(pageRaw);
	const sizeRaw = Number(search.pageSize);
	if (Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw !== 25) {
		out.pageSize = Math.floor(sizeRaw);
	}
	if (search.search != null && search.search !== "") {
		out.search = String(search.search);
	}
	if (
		typeof search.status === "string" &&
		(inviteStatusValues as string[]).includes(search.status) &&
		search.status !== "all"
	) {
		out.status = search.status as Exclude<InviteStatus, "all">;
	}
	return out;
}

export const Route = createFileRoute("/admin/access/invites")({
	component: InvitesTab,
	validateSearch: validateInvitesSearch,
});

type InviteFilters = {
	pageSize: number;
	search: string;
	status: InviteStatus;
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
	const search = Route.useSearch();
	const page = search.page ?? 1;
	const filters: InviteFilters = {
		pageSize: search.pageSize ?? defaultFilters.pageSize,
		search: search.search ?? defaultFilters.search,
		status: search.status ?? defaultFilters.status,
	};
	const navigate = useNavigate({ from: Route.fullPath });
	const setPage = (next: number) =>
		void navigate({
			search: (prev) => ({ ...prev, page: next > 1 ? next : undefined }),
		});
	const applyFilters = (values: InviteFilters) =>
		void navigate({
			search: () => ({
				pageSize:
					values.pageSize !== defaultFilters.pageSize
						? values.pageSize
						: undefined,
				search: values.search || undefined,
				status: values.status !== "all" ? values.status : undefined,
			}),
		});
	const resetFilters = () => void navigate({ search: () => ({}) });
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => applyFilters(value),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: sync form draft when URL filters change (back/forward).
	useEffect(() => {
		form.reset(filters);
	}, [filters.pageSize, filters.search, filters.status]);

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
	}, [
		session?.user.id,
		filters.pageSize,
		filters.search,
		filters.status,
		page,
	]);

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
								resetFilters();
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
					<p className="shrink-0 text-sm font-bold text-muted-foreground">
						{t("users.showing")} {firstItem}-{lastItem} {t("users.of")}{" "}
						{data?.total ?? 0}
					</p>
					<DataPagination
						page={data?.page ?? page}
						totalPages={data?.totalPages ?? 1}
						onPageChange={setPage}
						disabled={!data}
						previousLabel={t("users.previous")}
						nextLabel={t("users.next")}
					/>
				</div>

				<div className="mt-5 grid gap-3">
					{data?.items.length ? (
						data.items.map((invite) => (
							<DataRow key={invite.id}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="min-w-0 flex-1">
										<p className="font-medium">{invite.email}</p>
										<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
											<Link
												className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
												params={{ id: invite.roleId }}
												to="/admin/access/roles/$id"
											>
												{invite.roleName}
											</Link>
											<span className="text-muted-foreground/50">
												{invite.status === "pending"
													? `${t("table.expires")} ${new Date(invite.expiresAt).toLocaleString(locale)}`
													: invite.status === "accepted" && invite.acceptedAt
														? new Date(invite.acceptedAt).toLocaleString(locale)
														: `${t("table.expiredOn")} ${new Date(invite.expiresAt).toLocaleString(locale)}`}
											</span>
											{invite.invitedByName ? (
												<span>
													{t("users.invitedBy")}{" "}
													{invite.invitedBy ? (
														<Link
															className="rounded underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
															params={{ id: invite.invitedBy }}
															to="/admin/access/users/$id"
														>
															{invite.invitedByName}
														</Link>
													) : (
														invite.invitedByName
													)}
												</span>
											) : null}
											{invite.inviteUrl ? (
												<CopyButton
													className="shrink-0 !rounded-xl !px-2 !py-2"
													copiedLabel={t("actions.copied")}
													label={t("actions.copyLink")}
													text={invite.inviteUrl}
												/>
											) : null}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{invite.status === "pending" &&
										hasPermission("invites.update") ? (
											<Link
												params={{ id: invite.id }}
												to="/admin/invites/$id/edit"
											>
												<Button tone="secondary" type="button">
													{t("forms.update")}
												</Button>
											</Link>
										) : null}
										{invite.status === "accepted" &&
										invite.acceptedUserId &&
										hasPermission("users.read") ? (
											<Link
												params={{ id: invite.acceptedUserId }}
												to="/admin/access/users/$id"
											>
												<Button tone="secondary" type="button">
													{t("users.viewUser")}
												</Button>
											</Link>
										) : null}
										{invite.status === "pending" &&
										hasPermission("invites.delete") ? (
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
													{t("forms.delete")}
												</Button>
											</DeleteConfirmationDialog>
										) : null}
									</div>
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
