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
	FieldLabel,
	Input,
	Notice,
	Select,
} from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type { AdminDomain, LinkListData } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";

export const Route = createFileRoute("/admin/links")({
	component: LinksList,
});

type LinkFilters = {
	active: "all" | "active" | "inactive";
	hostname: string;
	pageSize: number;
	search: string;
	statusCode: "all" | "301" | "302";
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
	const [domains, setDomains] = useState<AdminDomain[]>([]);
	const [data, setData] = useState<LinkListData | null>(null);
	const [filters, setFilters] = useState<LinkFilters>(defaultFilters);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const isLinksListRoute =
		location.pathname === "/admin/links" ||
		location.pathname === "/admin/links/";
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => {
			setFilters(value);
			setPage(1);
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when filters, page, route, or the authenticated user identity change.
	useEffect(() => {
		if (!session || !isLinksListRoute) {
			return;
		}

		async function refresh() {
			setError(null);
			try {
				const api = getTreaty();
				const [nextDomains, nextData] = await Promise.all([
					unwrap<AdminDomain[]>(await api.admin.domains.get()),
					unwrap<LinkListData>(
						await api.admin.links.get({
							query: {
								active: filters.active,
								hostname: filters.hostname,
								page,
								pageSize: filters.pageSize,
								search: filters.search,
								statusCode:
									filters.statusCode === "301"
										? 301
										: filters.statusCode === "302"
											? 302
											: undefined,
							},
						}),
					),
				]);
				setDomains(nextDomains);
				setData(nextData);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void refresh();
	}, [filters, isLinksListRoute, page, session?.user.id]);

	if (!isLinksListRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	const firstItem =
		data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
	const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<Link
							className="text-sm font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
							to="/admin"
						>
							{t("pages.backDashboard")}
						</Link>
						<h1 className="mt-4 text-4xl font-black">{t("links.title")}</h1>
					</div>
					<Link
						className="inline-flex items-center justify-center rounded-2xl border border-transparent bg-stone-950 px-4 py-3 text-sm font-black text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
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
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								>
									<option value="all">{t("links.allHosts")}</option>
									<option value="__default__">{t("domains.default")}</option>
									{domains.map((domain) => (
										<option key={domain.id} value={domain.hostname}>
											{domain.hostname}
										</option>
									))}
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="active">
						{(field) => (
							<FieldLabel>
								{t("forms.active")}
								<Select
									onChange={(event) =>
										field.handleChange(
											event.target.value as LinkFilters["active"],
										)
									}
									value={field.state.value}
								>
									<option value="all">{t("links.allStates")}</option>
									<option value="active">{t("links.activeOnly")}</option>
									<option value="inactive">{t("links.inactiveOnly")}</option>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="statusCode">
						{(field) => (
							<FieldLabel>
								{t("forms.statusCode")}
								<Select
									onChange={(event) =>
										field.handleChange(
											event.target.value as LinkFilters["statusCode"],
										)
									}
									value={field.state.value}
								>
									<option value="all">{t("links.allStatusCodes")}</option>
									<option value="302">302</option>
									<option value="301">301</option>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="pageSize">
						{(field) => (
							<FieldLabel>
								{t("links.pageSize")}
								<Select
									onChange={(event) =>
										field.handleChange(Number(event.target.value))
									}
									value={field.state.value}
								>
									{[10, 25, 50, 100].map((size) => (
										<option key={size} value={size}>
											{size}
										</option>
									))}
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
					<p className="text-sm font-bold text-stone-600 dark:text-stone-300">
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
						<p className="rounded-2xl border border-stone-950/10 bg-white/70 p-6 text-center text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
							{t("dashboard.noLinks")}
						</p>
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
		<div className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
			<div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<Link
							className="font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
							params={{ id: link.id }}
							to="/admin/links/$id"
						>
							{link.slug}
						</Link>
						<span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
							{formatHostname(link.hostname, t)}
						</span>
						<StatusBadge
							label={String(link.statusCode)}
							variant={link.statusCode === 301 ? "blue" : "green"}
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
						<div className="mt-2 font-bold text-stone-900 dark:text-stone-100">
							{link.title}
						</div>
					) : null}
					<div className="mt-1 truncate text-sm text-stone-700 dark:text-stone-300">
						{link.targetUrl}
					</div>
					{link.notes ? (
						<div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">
							{link.notes}
						</div>
					) : null}
					<div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
						<span>
							{t("table.hits")}:{" "}
							<span className="font-bold text-stone-700 dark:text-stone-200">
								{link.hitCount}
							</span>
						</span>
						<span>
							{t("links.lastClick")}:{" "}
							<span className="text-stone-600 dark:text-stone-300">
								{formatDate(link.lastClickAt, locale, t)}
							</span>
						</span>
						<span>
							{t("links.created")}:{" "}
							<span className="text-stone-600 dark:text-stone-300">
								{new Date(link.createdAt).toLocaleDateString(locale)}
							</span>
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Link
						className="inline-flex items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-900 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:bg-stone-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
						params={{ id: link.id }}
						to="/admin/links/$id/edit"
					>
						{t("forms.update")}
					</Link>
				</div>
			</div>
		</div>
	);
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
		amber:
			"bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
		stone: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
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
