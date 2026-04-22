import { useForm } from "@tanstack/react-form";
import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, FieldLabel, Input, Notice, Select } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type { AdminDomain, LinkListData } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator } from "@/lib/i18n";

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
    location.pathname === "/admin/links" || location.pathname === "/admin/links/";
  const form = useForm({
    defaultValues: filters,
    onSubmit: ({ value }) => {
      setFilters(value);
      setPage(1);
    },
  });

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
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
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

  const firstItem = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
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
          <form.Field
            name="search"
            children={(field) => (
              <FieldLabel>
                {t("links.search")}
                <Input
                  onChange={(event) => field.handleChange(event.target.value)}
                  value={field.state.value}
                />
              </FieldLabel>
            )}
          />
          <form.Field
            name="hostname"
            children={(field) => (
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
          />
          <form.Field
            name="active"
            children={(field) => (
              <FieldLabel>
                {t("forms.active")}
                <Select
                  onChange={(event) =>
                    field.handleChange(event.target.value as LinkFilters["active"])
                  }
                  value={field.state.value}
                >
                  <option value="all">{t("links.allStates")}</option>
                  <option value="active">{t("links.activeOnly")}</option>
                  <option value="inactive">{t("links.inactiveOnly")}</option>
                </Select>
              </FieldLabel>
            )}
          />
          <form.Field
            name="statusCode"
            children={(field) => (
              <FieldLabel>
                {t("forms.statusCode")}
                <Select
                  onChange={(event) =>
                    field.handleChange(event.target.value as LinkFilters["statusCode"])
                  }
                  value={field.state.value}
                >
                  <option value="all">{t("links.allStatusCodes")}</option>
                  <option value="302">302</option>
                  <option value="301">301</option>
                </Select>
              </FieldLabel>
            )}
          />
          <form.Field
            name="pageSize"
            children={(field) => (
              <FieldLabel>
                {t("links.pageSize")}
                <Select
                  onChange={(event) => field.handleChange(Number(event.target.value))}
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
          />
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
                setPage((value) => Math.min(data?.totalPages ?? value, value + 1))
              }
              tone="secondary"
              type="button"
            >
              {t("links.next")}
            </Button>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-950/10 text-stone-600 dark:border-white/10 dark:text-stone-300">
                <th className="py-3">{t("table.slug")}</th>
                <th className="py-3">{t("table.host")}</th>
                <th className="py-3">{t("table.target")}</th>
                <th className="py-3">{t("table.hits")}</th>
                <th className="py-3">{t("links.lastClick")}</th>
                <th className="py-3">{t("links.created")}</th>
                <th className="py-3">{t("links.updated")}</th>
                <th className="py-3">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length ? (
                data.items.map((link) => (
                  <tr className="border-b border-stone-950/5 dark:border-white/5" key={link.id}>
                    <td className="py-3">
                      <Link
                        className="font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
                        params={{ id: link.id }}
                        to="/admin/links/$id"
                      >
                        {link.slug}
                      </Link>
                      <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">
                        {link.statusCode} ·{" "}
                        {link.isActive ? t("domains.active") : t("domains.inactive")}
                        {link.preserveQueryParams ? ` · ${t("forms.preserveQuery")}` : ""}
                      </div>
                    </td>
                    <td className="py-3">{formatHostname(link.hostname, t)}</td>
                    <td className="max-w-sm py-3">
                      {link.title ? <div className="font-bold">{link.title}</div> : null}
                      <div className="truncate text-stone-700 dark:text-stone-300">
                        {link.targetUrl}
                      </div>
                      {link.notes ? (
                        <div className="mt-1 max-w-sm truncate text-xs text-stone-600 dark:text-stone-300">
                          {link.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 font-black">{link.hitCount}</td>
                    <td className="py-3">{formatDate(link.lastClickAt, locale, t)}</td>
                    <td className="py-3">{formatDate(link.createdAt, locale, t)}</td>
                    <td className="py-3">{formatDate(link.updatedAt, locale, t)}</td>
                    <td className="py-3">
                      <Link
                        className="inline-flex items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-900 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:bg-stone-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
                        params={{ id: link.id }}
                        to="/admin/links/$id/edit"
                      >
                        {t("forms.update")}
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="py-5 text-sm text-stone-600 dark:text-stone-300"
                    colSpan={8}
                  >
                    {t("dashboard.noLinks")}
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

function formatHostname(hostname: string, t: ReturnType<typeof createTranslator>) {
  return hostname === "__default__" ? t("domains.default") : hostname;
}

function formatDate(
  value: number | null | undefined,
  locale: string,
  t: ReturnType<typeof createTranslator>,
) {
  return value ? new Date(value).toLocaleString(locale) : t("links.neverClicked");
}
