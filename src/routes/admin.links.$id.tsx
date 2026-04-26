import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button, Card, Notice } from "@/components/ui";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { LinkStatsResponse, UtmDimension } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator, MessageKey } from "@/lib/i18n";

export const Route = createFileRoute("/admin/links/$id")({
	component: LinkDetails,
});

const UTM_LABELS: Array<{ dimension: UtmDimension; key: MessageKey }> = [
	{ dimension: "utmSource", key: "stats.utmSource" },
	{ dimension: "utmMedium", key: "stats.utmMedium" },
	{ dimension: "utmCampaign", key: "stats.utmCampaign" },
	{ dimension: "utmTerm", key: "stats.utmTerm" },
	{ dimension: "utmContent", key: "stats.utmContent" },
];

function LinkDetails() {
	const { id } = Route.useParams();
	const location = useLocation();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized, hasPermission } = useRequirePermission("links.read");
	const [data, setData] = useState<LinkStatsResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const isDetailsRoute =
		location.pathname === `/admin/links/${id}` ||
		location.pathname === `/admin/links/${id}/`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the link id, route, or authenticated user identity changes.
	useEffect(() => {
		if (!session || !isDetailsRoute) {
			return;
		}

		async function load() {
			setError(null);
			try {
				const api = getTreaty();
				const response = await unwrap<LinkStatsResponse>(
					await api.admin.links({ id }).stats.get({ query: {} }),
				);
				setData(response);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, isDetailsRoute, session?.user.id]);

	if (!isDetailsRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	if (error) {
		return (
			<div className="mx-auto w-full max-w-5xl">
				<Notice tone="error">{t(error)}</Notice>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="mx-auto w-full max-w-5xl">
				<Card>{t("loading.dashboard")}</Card>
			</div>
		);
	}

	const { link, stats } = data;
	const hostLabel =
		link.hostname === "__default__" ? t("domains.default") : link.hostname;

	return (
		<div className="mx-auto grid w-full max-w-6xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<Link
							className="text-sm font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
							to="/admin/links"
						>
							{t("links.viewAll")}
						</Link>
						<h1 className="mt-4 text-4xl font-medium tracking-tight">
							{link.title ?? link.slug}
						</h1>
						<p className="mt-2 text-muted-foreground">
							<span className="font-medium">{hostLabel}</span>
							<span className="mx-2">/</span>
							<span className="font-medium">{link.slug}</span>
							<span className="mx-2">→</span>
							<span className="break-all">{link.targetUrl}</span>
						</p>
						{link.notes ? (
							<p className="mt-2 text-sm text-muted-foreground">{link.notes}</p>
						) : null}
					</div>
					{hasPermission("links.write") ? (
						<Link params={{ id: link.id }} to="/admin/links/$id/edit">
							<Button type="button">{t("forms.update")}</Button>
						</Link>
					) : null}
				</div>
			</Card>

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{stats ? (
					<>
						<Stat label={t("stats.allTimeHits")} value={stats.totals.allTime} />
						<Stat
							label={t("stats.windowHits").replace(
								"{{days}}",
								String(stats.windowDays),
							)}
							value={stats.totals.window}
						/>
					</>
				) : null}
				<Stat label={t("stats.statusCode")} value={link.statusCode} />
				<Stat
					label={t("stats.state")}
					text={link.isActive ? t("domains.active") : t("domains.inactive")}
				/>
			</section>

			{stats ? (
				<>
					<Card>
						<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
							<h2 className="text-2xl font-medium">
								{t("stats.histogramTitle")}
							</h2>
							<p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
								{t("stats.lastDays").replace(
									"{{days}}",
									String(stats.windowDays),
								)}
							</p>
						</div>
						<ClicksByDayChart
							buckets={stats.histogram}
							clickLabel={t("table.hits")}
							locale={locale}
						/>
					</Card>

					<section className="grid gap-4 lg:grid-cols-2">
						{UTM_LABELS.map(({ dimension, key }) => (
							<UtmBreakdown
								dimension={dimension}
								key={dimension}
								rows={stats.breakdowns[dimension]}
								title={t(key)}
								total={stats.totals.window}
								t={t}
							/>
						))}
					</section>

					<Card>
						<h2 className="text-2xl font-medium">{t("stats.recentTitle")}</h2>
						<div className="mt-4 overflow-x-auto">
							<table className="min-w-full text-left text-sm">
								<thead>
									<tr className="border-b border-foreground/10 text-muted-foreground ">
										<th className="py-3">{t("table.when")}</th>
										<th className="py-3">{t("table.country")}</th>
										<th className="py-3">{t("stats.utmSource")}</th>
										<th className="py-3">{t("stats.utmMedium")}</th>
										<th className="py-3">{t("stats.utmCampaign")}</th>
										<th className="py-3">{t("table.referer")}</th>
									</tr>
								</thead>
								<tbody>
									{stats.recentEvents.length ? (
										stats.recentEvents.map((event) => (
											<tr className="border-b border-border/60" key={event.id}>
												<td className="py-3">
													{new Date(event.createdAt).toLocaleString(locale)}
												</td>
												<td className="py-3">
													{event.country ?? t("table.direct")}
												</td>
												<td className="py-3">{event.utmSource ?? "—"}</td>
												<td className="py-3">{event.utmMedium ?? "—"}</td>
												<td className="py-3">{event.utmCampaign ?? "—"}</td>
												<td className="max-w-xs truncate py-3">
													{event.referer ?? t("table.direct")}
												</td>
											</tr>
										))
									) : (
										<tr>
											<td
												className="py-5 text-sm text-muted-foreground"
												colSpan={6}
											>
												{t("stats.noEvents")}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</Card>
				</>
			) : null}
		</div>
	);
}

function Stat({
	label,
	value,
	text,
}: {
	label: string;
	value?: number;
	text?: string;
}) {
	return (
		<Card>
			<p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
				{label}
			</p>
			<p className="mt-2 text-4xl font-medium text-foreground">
				{text ?? value ?? 0}
			</p>
		</Card>
	);
}

function ClicksByDayChart({
	buckets,
	clickLabel,
	locale,
}: {
	buckets: Array<{ day: number; total: number }>;
	clickLabel: string;
	locale: string;
}) {
	const chartConfig = useMemo(
		() =>
			({
				clicks: {
					label: clickLabel,
					color: "var(--chart-1)",
				},
			}) satisfies ChartConfig,
		[clickLabel],
	);
	const dayFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				day: "2-digit",
				month: "short",
			}),
		[locale],
	);
	const tooltipFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				day: "numeric",
				month: "long",
				year: "numeric",
			}),
		[locale],
	);
	const chartData = useMemo(
		() =>
			buckets.map((bucket) => ({
				clicks: bucket.total,
				day: bucket.day,
				label: dayFormatter.format(new Date(bucket.day)),
			})),
		[buckets, dayFormatter],
	);

	const firstBucket = buckets[0];
	const lastBucket = buckets[buckets.length - 1];
	if (!firstBucket || !lastBucket) {
		return null;
	}

	return (
		<div className="mt-4">
			<ChartContainer
				className="h-[260px] w-full sm:h-[320px]"
				config={chartConfig}
			>
				<BarChart
					accessibilityLayer
					data={chartData}
					margin={{ left: -12, right: 8, top: 8 }}
				>
					<CartesianGrid strokeDasharray="3 3" vertical={false} />
					<XAxis
						axisLine={false}
						dataKey="label"
						interval="preserveStartEnd"
						minTickGap={18}
						tickLine={false}
						tickMargin={10}
					/>
					<YAxis
						allowDecimals={false}
						axisLine={false}
						tickLine={false}
						tickMargin={8}
						width={36}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								hideLabel={false}
								indicator="line"
								labelFormatter={(_label, payload) => {
									const day = payload?.[0]?.payload?.day;
									return typeof day === "number"
										? tooltipFormatter.format(new Date(day))
										: null;
								}}
							/>
						}
					/>
					<Bar
						dataKey="clicks"
						fill="var(--color-clicks)"
						radius={[5, 5, 2, 2]}
					/>
				</BarChart>
			</ChartContainer>
			<div className="mt-3 flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
				<span>{dayFormatter.format(new Date(firstBucket.day))}</span>
				<span>{dayFormatter.format(new Date(lastBucket.day))}</span>
			</div>
		</div>
	);
}

function UtmBreakdown({
	dimension,
	rows,
	title,
	total,
	t,
}: {
	dimension: UtmDimension;
	rows: Array<{ value: string | null; total: number }>;
	title: string;
	total: number;
	t: ReturnType<typeof createTranslator>;
}) {
	return (
		<Card>
			<h3 className="text-lg font-medium">{title}</h3>
			<div className="mt-4 grid gap-2">
				{rows.length ? (
					rows.map((row) => {
						const pct = total > 0 ? Math.round((row.total / total) * 100) : 0;
						const label = row.value ?? t("stats.emptyUtm");
						return (
							<BreakdownRow
								key={`${dimension}-${row.value ?? "__null__"}`}
								label={label}
								pct={pct}
								total={row.total}
							/>
						);
					})
				) : (
					<p className="text-sm text-muted-foreground">{t("stats.noEvents")}</p>
				)}
			</div>
		</Card>
	);
}

function BreakdownRow({
	label,
	pct,
	total,
}: {
	label: ReactNode;
	pct: number;
	total: number;
}) {
	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between gap-3 text-sm">
				<span className="truncate font-bold">{label}</span>
				<span className="font-medium text-foreground dark:text-background">
					{total} · {pct}%
				</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10 dark:bg-white/10">
				<div
					className="h-full bg-foreground"
					style={{ width: `${Math.max(2, pct)}%` }}
				/>
			</div>
		</div>
	);
}
