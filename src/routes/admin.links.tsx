import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DataRow,
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
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminDomain, LinkListData } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";
import {
	parseRedirectStatusCodeFilter,
	type RedirectStatusCodeFilter,
	redirectStatusOptions,
} from "@/lib/redirect-status";

export const Route = createFileRoute("/admin/links")({
	component: LinksList,
});

type LinkFilters = {
	active: "all" | "active" | "inactive";
	hostname: string;
	pageSize: number;
	search: string;
	statusCode: RedirectStatusCodeFilter;
};

const defaultFilters: LinkFilters = {
	active: "all",
	hostname: "all",
	pageSize: 25,
	search: "",
	statusCode: "all",
};

function LinksList() {
	const location = useLocation();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const {
		hasPermission,
		isAuthorized,
		isPending: isPermissionPending,
	} = useRequirePermission("links.read");
	const [domains, setDomains] = useState<AdminDomain[]>([]);
	const [data, setData] = useState<LinkListData | null>(null);
	const [filters, setFilters] = useState<LinkFilters>(defaultFilters);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const isLinksListRoute =
		location.pathname === "/admin/links" ||
		location.pathname === "/admin/links/";
	const canViewDomains = hasPermission("domains.read");
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => {
			setFilters(value);
			setPage(1);
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when filters, page, route, or the authenticated user identity change.
	useEffect(() => {
		if (!session || !isLinksListRoute || isPermissionPending || !isAuthorized) {
			return;
		}

		async function refresh() {
			setError(null);
			try {
				const api = getTreaty();
				const nextData = await unwrap<LinkListData>(
					await api.admin.links.get({
						query: {
							active: filters.active,
							hostname: filters.hostname,
							page,
							pageSize: filters.pageSize,
							search: filters.search,
							statusCode: parseRedirectStatusCodeFilter(filters.statusCode),
						},
					}),
				);
				const nextDomains = canViewDomains
					? await unwrap<AdminDomain[]>(await api.admin.domains.get())
					: [];
				setDomains(nextDomains);
				setData(nextData);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void refresh();
	}, [
		canViewDomains,
		filters,
		isAuthorized,
		isLinksListRoute,
		isPermissionPending,
		page,
		session?.user.id,
	]);

	if (!isLinksListRoute) {
		return <Outlet />;
	}

	if (isPending || isPermissionPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const firstItem =
		data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
	const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<h1 className="text-4xl font-medium">{t("links.title")}</h1>
					</div>
					<Link
						className="inline-flex items-center justify-center rounded-md border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						to="/admin/links/new"
					>
						{t("actions.addLink")}
					</Link>
				</div>

				<form
					className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_0.8fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="search">
						{(field) => (
							<FieldLabel>
								{t("links.search")}
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="hostname">
						{(field) => (
							<FieldLabel>
								{t("forms.hostname")}
								<Select
									onValueChange={field.handleChange}
									value={field.state.value}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("links.allHosts")}</SelectItem>
										<SelectItem value="__default__">
											{t("domains.default")}
										</SelectItem>
										{domains.map((domain) => (
											<SelectItem key={domain.id} value={domain.hostname}>
												{domain.hostname}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="active">
						{(field) => (
							<FieldLabel>
								{t("forms.active")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as LinkFilters["active"])
									}
									value={field.state.value}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("links.allStates")}</SelectItem>
										<SelectItem value="active">
											{t("links.activeOnly")}
										</SelectItem>
										<SelectItem value="inactive">
											{t("links.inactiveOnly")}
										</SelectItem>
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="statusCode">
						{(field) => (
							<FieldLabel>
								{t("forms.statusCode")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as LinkFilters["statusCode"])
									}
									value={field.state.value}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											{t("links.allStatusCodes")}
										</SelectItem>
										{redirectStatusOptions.map((option) => (
											<SelectItem key={option.code} value={String(option.code)}>
												{t(option.labelKey)}
											</SelectItem>
										))}
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
						{t("links.showing")} {firstItem}-{lastItem} {t("links.of")}{" "}
						{data?.total ?? 0}
					</p>
					<div className="flex gap-2">
						<Button
							disabled={!data || data.page <= 1}
							onClick={() => setPage((value) => Math.max(1, value - 1))}
							tone="secondary"
							type="button"
						>
							{t("links.previous")}
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
							{t("links.next")}
						</Button>
					</div>
				</div>
				<div className="mt-5 grid gap-3">
					{data?.items.map((link) => (
						<LinkRow key={link.id} link={link} locale={locale} t={t} />
					))}
					{!data?.items.length ? (
						<EmptyState description={t("dashboard.noLinks")} />
					) : null}
				</div>
			</Card>
		</div>
	);
}

function LinkRow({
	link,
	locale,
	t,
}: {
	link: LinkListData["items"][number];
	locale: string;
	t: ReturnType<typeof createTranslator>;
}) {
	return (
		<DataRow>
			<div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<Link
							className="font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
							params={{ id: link.id }}
							to="/admin/links/$id"
						>
							{link.slug}
						</Link>
						<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
							{formatHostname(link.hostname, t)}
						</span>
						<StatusBadge
							label={String(link.statusCode)}
							variant={getRedirectStatusBadgeVariant(link.statusCode)}
						/>
						<StatusBadge
							label={
								link.isActive ? t("domains.active") : t("domains.inactive")
							}
							variant={link.isActive ? "green" : "stone"}
						/>
						{link.preserveQueryParams ? (
							<StatusBadge label={t("forms.preserveQuery")} variant="amber" />
						) : null}
					</div>
					{link.title ? (
						<div className="mt-2 font-bold text-foreground">{link.title}</div>
					) : null}
					<div className="mt-1 truncate text-sm text-muted-foreground">
						{link.targetUrl}
					</div>
					{link.notes ? (
						<div className="mt-1 truncate text-xs text-muted-foreground/80">
							{link.notes}
						</div>
					) : null}
					<div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground/80">
						<span>
							{t("table.hits")}:{" "}
							<span className="font-bold text-foreground">{link.hitCount}</span>
						</span>
						<span>
							{t("links.lastClick")}:{" "}
							<span className="text-muted-foreground">
								{formatDate(link.lastClickAt, locale, t)}
							</span>
						</span>
						<span>
							{t("links.created")}:{" "}
							<span className="text-muted-foreground">
								{new Date(link.createdAt).toLocaleDateString(locale)}
							</span>
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Link
						className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						params={{ id: link.id }}
						to="/admin/links/$id/edit"
					>
						{t("forms.update")}
					</Link>
				</div>
			</div>
		</DataRow>
	);
}

function getRedirectStatusBadgeVariant(statusCode: number) {
	return statusCode === 301 || statusCode === 308 ? "blue" : "green";
}

function StatusBadge({
	label,
	variant,
}: {
	label: string;
	variant: "green" | "blue" | "amber" | "stone";
}) {
	const variants = {
		green:
			"bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
		blue: "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100",
		amber: "bg-accent/10 text-accent border border-accent/20",
		stone: "bg-muted text-muted-foreground",
	};

	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${variants[variant]}`}
		>
			{label}
		</span>
	);
}

function formatHostname(
	hostname: string,
	t: ReturnType<typeof createTranslator>,
) {
	return hostname === "__default__" ? t("domains.default") : hostname;
}

function formatDate(
	value: number | null | undefined,
	locale: string,
	t: ReturnType<typeof createTranslator>,
) {
	return value
		? new Date(value).toLocaleString(locale)
		: t("links.neverClicked");
}
