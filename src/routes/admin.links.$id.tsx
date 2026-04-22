import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type { LinkStatsResponse, UtmDimension } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, type MessageKey } from "@/lib/i18n";

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
  const [data, setData] = useState<LinkStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDetailsRoute =
    location.pathname === `/admin/links/${id}` ||
    location.pathname === `/admin/links/${id}/`;

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
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
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
  const hostLabel = link.hostname === "__default__" ? t("domains.default") : link.hostname;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <Card>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <Link
              className="text-sm font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
              to="/admin/links"
            >
              {t("links.viewAll")}
            </Link>
            <h1 className="mt-4 text-4xl font-black tracking-tight">
              {link.title ?? link.slug}
            </h1>
            <p className="mt-2 text-stone-700 dark:text-stone-300">
              <span className="font-black">{hostLabel}</span>
              <span className="mx-2">/</span>
              <span className="font-black">{link.slug}</span>
              <span className="mx-2">→</span>
              <span className="break-all">{link.targetUrl}</span>
            </p>
            {link.notes ? (
              <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{link.notes}</p>
            ) : null}
          </div>
          <Link
            className="inline-flex items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-900 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:bg-stone-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
            params={{ id: link.id }}
            to="/admin/links/$id/edit"
          >
            {t("forms.update")}
          </Link>
        </div>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("stats.allTimeHits")} value={stats.totals.allTime} />
        <Stat
          label={t("stats.windowHits").replace("{{days}}", String(stats.windowDays))}
          value={stats.totals.window}
        />
        <Stat label={t("stats.statusCode")} value={link.statusCode} />
        <Stat
          label={t("stats.state")}
          text={link.isActive ? t("domains.active") : t("domains.inactive")}
        />
      </section>

      <Card>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-2xl font-black">{t("stats.histogramTitle")}</h2>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-600 dark:text-stone-300">
            {t("stats.lastDays").replace("{{days}}", String(stats.windowDays))}
          </p>
        </div>
        <Histogram buckets={stats.histogram} locale={locale} />
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
        <h2 className="text-2xl font-black">{t("stats.recentTitle")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-950/10 text-stone-600 dark:border-white/10 dark:text-stone-300">
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
                  <tr className="border-b border-stone-950/5 dark:border-white/5" key={event.id}>
                    <td className="py-3">{new Date(event.createdAt).toLocaleString(locale)}</td>
                    <td className="py-3">{event.country ?? t("table.direct")}</td>
                    <td className="py-3">{event.utmSource ?? "—"}</td>
                    <td className="py-3">{event.utmMedium ?? "—"}</td>
                    <td className="py-3">{event.utmCampaign ?? "—"}</td>
                    <td className="max-w-xs truncate py-3">{event.referer ?? t("table.direct")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="py-5 text-sm text-stone-600 dark:text-stone-300" colSpan={6}>
                    {t("stats.noEvents")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
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
      <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-600 dark:text-stone-300">
        {label}
      </p>
      <p className="mt-2 text-4xl font-black text-stone-950 dark:text-amber-50">
        {text ?? value ?? 0}
      </p>
    </Card>
  );
}

function Histogram({
  buckets,
  locale,
}: {
  buckets: Array<{ day: number; total: number }>;
  locale: string;
}) {
  const max = useMemo(
    () => buckets.reduce((acc, bucket) => Math.max(acc, bucket.total), 0),
    [buckets],
  );
  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
      }),
    [locale],
  );

  if (!buckets.length) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="flex items-end gap-1" aria-hidden="true">
        {buckets.map((bucket) => {
          const height = max > 0 ? Math.max(4, Math.round((bucket.total / max) * 100)) : 2;
          return (
            <div
              key={bucket.day}
              className="flex-1"
              title={`${dayFormatter.format(new Date(bucket.day))} · ${bucket.total}`}
            >
              <div
                className="w-full rounded-t-md bg-stone-950 transition dark:bg-amber-200"
                style={{ height: `${height}px` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-stone-600 dark:text-stone-300">
        <span>{dayFormatter.format(new Date(buckets[0]!.day))}</span>
        <span>{dayFormatter.format(new Date(buckets[buckets.length - 1]!.day))}</span>
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
      <h3 className="text-lg font-black">{title}</h3>
      <div className="mt-4 grid gap-2">
        {rows.length ? (
          rows.map((row, index) => {
            const pct = total > 0 ? Math.round((row.total / total) * 100) : 0;
            const label = row.value ?? t("stats.emptyUtm");
            return (
              <BreakdownRow
                key={`${dimension}-${index}-${row.value ?? "null"}`}
                label={label}
                pct={pct}
                total={row.total}
              />
            );
          })
        ) : (
          <p className="text-sm text-stone-600 dark:text-stone-300">{t("stats.noEvents")}</p>
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
        <span className="font-black text-stone-900 dark:text-amber-100">
          {total} · {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-950/10 dark:bg-white/10">
        <div
          className="h-full bg-stone-950 dark:bg-amber-200"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
