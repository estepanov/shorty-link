import { useForm } from "@tanstack/react-form";
import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { AppShell, Button, Card, FieldLabel, Input, Notice, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  component: Admin,
});

type DashboardData = {
  domains: Array<{
    id: string;
    hostname: string;
    label: string | null;
    isPrimary: boolean;
    isActive: boolean;
    createdAt: number;
  }>;
  events: Array<{
    id: string;
    createdAt: number;
    hostname: string;
    slug: string;
    country: string | null;
    referer: string | null;
  }>;
  invites: Array<{
    id: string;
    email: string;
    inviteUrl: string;
    createdAt: number;
    expiresAt: number;
  }>;
  links: Array<{
    id: string;
    hostname: string;
    slug: string;
    targetUrl: string;
    title: string | null;
    notes: string | null;
    statusCode: number;
    preserveQueryParams: boolean;
    isActive: boolean;
    hitCount: number;
    createdAt: number;
    updatedAt: number;
  }>;
  session: {
    user: {
      id: string;
      email: string;
      name: string;
      locale?: string;
    };
  };
  summary: {
    domains: number;
    invites: number;
    links: number;
    redirects: number;
  };
};

type BootstrapState = {
  canBootstrap: boolean;
  hasUsers: boolean;
};

function Admin() {
  const location = useLocation();
  const { data: session, isPending } = authClient.useSession();
  const locale =
    (session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const isInviteRoute = location.pathname.startsWith("/admin/invite/");
  const isDashboardRoute =
    location.pathname === "/admin" || location.pathname === "/admin/";
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const api = getTreaty();
      const bootstrapState = await unwrap<BootstrapState>(await api.admin.bootstrap.get());
      setBootstrap(bootstrapState);

      if (session && isDashboardRoute) {
        const nextDashboard = await unwrap<DashboardData>(
          await api.admin.dashboard.get(),
        );
        setDashboard(nextDashboard);
      } else if (!isDashboardRoute) {
        setDashboard(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "errors.unknown");
    }
  }

  useEffect(() => {
    if (isInviteRoute) {
      return;
    }

    void refresh();
  }, [isDashboardRoute, isInviteRoute, session?.user?.id]);

  if (isInviteRoute) {
    return <Outlet />;
  }

  if (!bootstrap) {
    return (
      <AppShell locale={locale}>
        <main className="mx-auto max-w-7xl px-5 py-10">
          <Card>{t("loading.app")}</Card>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell locale={locale}>
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-8">
        {error ? <Notice tone="error">{t(error)}</Notice> : null}
        {!session ? (
          bootstrap.canBootstrap ? (
            <BootstrapForm locale={locale} />
          ) : (
            <PasskeyLogin />
          )
        ) : !isDashboardRoute ? (
          <Outlet />
        ) : dashboard ? (
          <DashboardView data={dashboard} />
        ) : (
          <Card>{t("loading.dashboard")}</Card>
        )}
      </main>
    </AppShell>
  );
}

function mapPasskeyError(raw: unknown): string {
  const code =
    typeof raw === "object" && raw !== null && "code" in raw
      ? String((raw as { code?: unknown }).code ?? "")
      : "";
  const name =
    raw instanceof Error
      ? raw.name
      : typeof raw === "object" && raw !== null && "name" in raw
        ? String((raw as { name?: unknown }).name ?? "")
        : "";
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "object" && raw !== null && "message" in raw
        ? String((raw as { message?: unknown }).message ?? "")
        : "";
  const normalizedCode = code.toUpperCase();
  const normalizedName = name.toUpperCase();

  if (message.startsWith("errors.")) return message;
  if (
    normalizedCode === "PASSKEY_CANCELLED" ||
    normalizedCode === "ERROR_CREDENTIAL_NOT_FOUND" ||
    normalizedName === "NOTALLOWEDERROR" ||
    normalizedName === "ABORTERROR"
  ) {
    return "errors.passkeyCancelled";
  }
  if (
    normalizedCode === "PASSKEY_NOT_FOUND" ||
    normalizedCode === "CREDENTIAL_NOT_FOUND" ||
    normalizedCode === "NO_CREDENTIAL" ||
    normalizedName === "INVALIDSTATEERROR"
  ) {
    return "errors.passkeyNotFound";
  }
  if (
    normalizedCode === "PASSKEY_NOT_SUPPORTED" ||
    normalizedName === "NOTSUPPORTEDERROR" ||
    normalizedName === "SECURITYERROR"
  ) {
    return "errors.passkeyUnsupported";
  }
  return "errors.passkeyVerifyFailed";
}

function PasskeyLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = createTranslator(defaultLocale);


  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.passkey({ autoFill: false });
      if (result?.error) {
        setError(mapPasskeyError(result.error));
        return;
      }
      if (result?.data && !("error" in (result as object) && result.error)) {
        await router.navigate({ to: "/admin" });
        return;
      }
      setError("errors.passkeyVerifyFailed");
    } catch (nextError) {
      setError(mapPasskeyError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-800 dark:text-blue-300">
        {t("auth.noPasswords")}
      </p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-stone-950 dark:text-amber-50">
        {t("auth.signIn")}
      </h1>
      <p className="mt-4 text-stone-700 dark:text-stone-300">
        {t("auth.loginHint")}
      </p>
      <Button className="mt-6" disabled={busy} onClick={signIn} type="button">
        {busy ? t("auth.waiting") : t("auth.signIn")}
      </Button>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">
            <p className="font-bold">{t(error)}</p>
            <p className="mt-1">{t("auth.passkeyRemediation")}</p>
            <div className="mt-3">
              <Button
                disabled={busy}
                onClick={signIn}
                tone="secondary"
                type="button"
              >
                {t("auth.tryAgain")}
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}
    </Card>
  );
}

function BootstrapForm({ locale }: { locale: string }) {
  const router = useRouter();
  const t = createTranslator(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      email: "",
      locale,
      name: "",
    },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setError(null);
      try {
        const api = getTreaty();
        const { context } = await unwrap<{ context: string }>(
          await api.admin.onboarding.bootstrap.post(value),
        );
        const result = await authClient.passkey.addPasskey({
          context,
          name: `${value.email} primary passkey`,
        });

        if (result.error) {
          throw new Error(result.error.message ?? "errors.unknown");
        }

        await authClient.signIn.passkey({ autoFill: false });
        await router.navigate({ to: "/admin" });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
        setBusy(false);
      }
    },
  });

  return (
    <Card className="mx-auto max-w-3xl">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-orange-700 dark:text-orange-300">
        {t("auth.noPasswords")}
      </p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-stone-950 dark:text-amber-50">
        {t("auth.bootstrapTitle")}
      </h1>
      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="name"
          children={(field) => (
            <FieldLabel>
              {t("forms.name")}
              <Input
                autoComplete="name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
                value={field.state.value}
              />
            </FieldLabel>
          )}
        />
        <form.Field
          name="email"
          children={(field) => (
            <FieldLabel>
              {t("forms.email")}
              <Input
                autoComplete="username webauthn"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
                type="email"
                value={field.state.value}
              />
            </FieldLabel>
          )}
        />
        <form.Field
          name="locale"
          children={(field) => (
            <FieldLabel>
              {t("forms.locale")}
              <Select
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                value={field.state.value}
              >
                {supportedLocales.map((option) => (
                  <option key={option} value={option}>
                    {option.toUpperCase()}
                  </option>
                ))}
              </Select>
            </FieldLabel>
          )}
        />
        <Button disabled={busy} type="submit">
          {busy ? t("auth.waiting") : t("auth.addPasskey")}
        </Button>
      </form>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{t(error)}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function DashboardView({ data }: { data: DashboardData }) {
  const locale = data.session.user.locale ?? defaultLocale;
  const t = createTranslator(locale);

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[2rem] border border-stone-950/10 bg-stone-950 p-6 text-amber-50 shadow-[0_24px_80px_rgba(29,27,22,0.10)] dark:border-white/10 dark:bg-stone-900/95 dark:shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
          <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
            {t("dashboard.title")}
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight">
            {data.session.user.name}
          </h1>
          <p className="mt-2 text-amber-100/80">{data.session.user.email}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ActionLink to="/admin/links/new">{t("actions.addLink")}</ActionLink>
            <ActionLink to="/admin/domains/new">{t("actions.addDomain")}</ActionLink>
            <ActionLink to="/admin/invites/new">{t("actions.addInvite")}</ActionLink>
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label={t("dashboard.links")} value={data.summary.links} />
          <Stat label={t("dashboard.redirects")} value={data.summary.redirects} />
          <Stat label={t("dashboard.domains")} value={data.summary.domains} />
          <Stat label={t("dashboard.invites")} value={data.summary.invites} />
        </div>
      </section>

      <Card>
        <h2 className="text-2xl font-black">{t("dashboard.recentRedirects")}</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-950/10 text-stone-600 dark:border-white/10 dark:text-stone-300">
                <th className="py-3">{t("table.when")}</th>
                <th className="py-3">{t("table.host")}</th>
                <th className="py-3">{t("table.slug")}</th>
                <th className="py-3">{t("table.country")}</th>
                <th className="py-3">{t("table.referer")}</th>
              </tr>
            </thead>
            <tbody>
              {data.events.length ? (
                data.events.map((event) => (
                  <tr className="border-b border-stone-950/5 dark:border-white/5" key={event.id}>
                    <td className="py-3">{new Date(event.createdAt).toLocaleString(locale)}</td>
                    <td className="py-3">{formatHostname(event.hostname, t)}</td>
                    <td className="py-3 font-black">{event.slug}</td>
                    <td className="py-3">{event.country ?? t("table.direct")}</td>
                    <td className="max-w-xs truncate py-3">{event.referer ?? t("table.direct")}</td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={5} label={t("dashboard.noRedirects")} />
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="text-2xl font-black">{t("dashboard.latestLinks")}</h2>
            <div className="flex flex-wrap gap-2">
              <ActionLink to="/admin/links">{t("links.viewAll")}</ActionLink>
              <ActionLink to="/admin/links/new" tone="primary">
                {t("actions.addLink")}
              </ActionLink>
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
                  <th className="py-3">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.links.length ? (
                  data.links.map((link) => (
                    <tr className="border-b border-stone-950/5 dark:border-white/5" key={link.id}>
                      <td className="py-3">
                        <Link
                          className="font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
                          params={{ id: link.id }}
                          to="/admin/links/$id"
                        >
                          {link.slug}
                        </Link>
                      </td>
                      <td className="py-3">{formatHostname(link.hostname, t)}</td>
                      <td className="max-w-xs truncate py-3">{link.targetUrl}</td>
                      <td className="py-3">{link.hitCount}</td>
                      <td className="py-3">
                        <ActionLink to={`/admin/links/${link.id}/edit`}>
                          {t("forms.update")}
                        </ActionLink>
                      </td>
                    </tr>
                  ))
                ) : (
                  <EmptyTableRow colSpan={5} label={t("dashboard.noLinks")} />
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6">
          <Card>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-2xl font-black">{t("dashboard.latestDomains")}</h2>
              <ActionLink to="/admin/domains/new" tone="primary">
                {t("actions.addDomain")}
              </ActionLink>
            </div>
            <div className="mt-5 grid gap-3">
              {data.domains.length ? (
                data.domains.map((domain) => (
                  <div
                    className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
                    key={domain.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black">{domain.hostname}</p>
                        <p className="text-sm text-stone-600 dark:text-stone-300">
                          {domain.label ?? t("domains.noLabel")} ·{" "}
                          {domain.isPrimary ? t("domains.primary") : t("domains.secondary")} ·{" "}
                          {domain.isActive ? t("domains.active") : t("domains.inactive")}
                        </p>
                      </div>
                      <ActionLink to={`/admin/domains/${domain.id}/edit`}>
                        {t("forms.update")}
                      </ActionLink>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
                  {t("dashboard.noDomains")}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-2xl font-black">{t("dashboard.latestInvites")}</h2>
              <ActionLink to="/admin/invites/new" tone="primary">
                {t("actions.addInvite")}
              </ActionLink>
            </div>
            <div className="mt-5 grid gap-3">
              {data.invites.length ? (
                data.invites.map((invite) => (
                  <a
                    className="break-all rounded-2xl border border-stone-950/10 bg-white/70 p-4 text-sm underline decoration-blue-700 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/5 dark:decoration-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950"
                    href={invite.inviteUrl}
                    key={invite.id}
                  >
                    <span className="font-black">{invite.email}</span>
                    <span className="mt-1 block text-stone-600 dark:text-stone-300">
                      {t("table.expires")} {new Date(invite.expiresAt).toLocaleDateString(locale)}
                    </span>
                    {invite.inviteUrl}
                  </a>
                ))
              ) : (
                <p className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
                  {t("dashboard.noInvites")}
                </p>
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function formatHostname(hostname: string, t: ReturnType<typeof createTranslator>) {
  return hostname === "__default__" ? t("domains.default") : hostname;
}

function ActionLink({
  children,
  to,
  tone = "secondary",
}: {
  children: ReactNode;
  to: string;
  tone?: "primary" | "secondary";
}) {
  const styles =
    tone === "primary"
      ? "bg-stone-950 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
      : "border-stone-200 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:bg-stone-800";

  return (
    <Link
      className={`inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950 ${styles}`}
      to={to}
    >
      {children}
    </Link>
  );
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td className="py-4 text-sm text-stone-600 dark:text-stone-300" colSpan={colSpan}>
        {label}
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-600 dark:text-stone-300">
        {label}
      </p>
      <p className="mt-2 text-4xl font-black text-stone-950 dark:text-amber-50">{value}</p>
    </Card>
  );
}
