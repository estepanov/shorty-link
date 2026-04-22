import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell, Button, Card, FieldLabel, Input, Notice, Select, TextArea } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";
import { getTreaty } from "@/lib/eden";

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
    links: number;
    redirects: number;
  };
};

type BootstrapState = {
  canBootstrap: boolean;
  hasUsers: boolean;
};

async function unwrap<T>(response: { data: unknown; error: unknown }) {
  if (response.error) {
    const error = response.error as { value?: { message?: string }; message?: string };
    throw new Error(error.value?.message ?? error.message ?? "errors.unknown");
  }

  if (response.data instanceof Response) {
    throw new Error(await response.data.text().catch(() => "errors.unknown"));
  }

  return response.data as T;
}

function Admin() {
  const { data: session, isPending } = authClient.useSession();
  const locale =
    (session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const api = getTreaty();
      const bootstrapState = await unwrap<BootstrapState>(await api.admin.bootstrap.get());
      setBootstrap(bootstrapState);

      if (session) {
        const nextDashboard = await unwrap<DashboardData>(
          await api.admin.dashboard.get(),
        );
        setDashboard(nextDashboard);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "errors.unknown");
    }
  }

  useEffect(() => {
    void refresh();
  }, [session?.user?.id]);

  if (isPending || !bootstrap) {
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
        ) : dashboard ? (
          <DashboardView data={dashboard} onChange={refresh} />
        ) : (
          <Card>{t("loading.dashboard")}</Card>
        )}
      </main>
    </AppShell>
  );
}

function PasskeyLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = createTranslator(defaultLocale);

  useEffect(() => {
    const credential = globalThis.PublicKeyCredential;
    if (!credential?.isConditionalMediationAvailable) {
      return;
    }

    void credential.isConditionalMediationAvailable().then((available) => {
      if (available) {
        void authClient.signIn.passkey({ autoFill: true });
      }
    });
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.passkey({ autoFill: false });

    if (result.error) {
      setError(result.error.message ?? "errors.unauthorized");
      setBusy(false);
      return;
    }

    window.location.assign("/admin");
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-800">
        {t("auth.noPasswords")}
      </p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-stone-950">
        {t("auth.signIn")}
      </h1>
      <p className="mt-4 text-stone-700">
        {t("auth.loginHint")}
      </p>
      <Button className="mt-6" disabled={busy} onClick={signIn} type="button">
        {busy ? t("auth.waiting") : t("auth.signIn")}
      </Button>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function BootstrapForm({ locale }: { locale: string }) {
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
        window.location.assign("/admin");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
        setBusy(false);
      }
    },
  });

  return (
    <Card className="mx-auto max-w-3xl">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-orange-700">
        {t("auth.noPasswords")}
      </p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-stone-950">
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

function DashboardView({
  data,
  onChange,
}: {
  data: DashboardData;
  onChange: () => Promise<void>;
}) {
  const locale = data.session.user.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const [editingLink, setEditingLink] = useState<DashboardData["links"][number] | null>(null);

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <Card className="bg-stone-950 text-amber-50">
          <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
            {t("dashboard.title")}
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight">
            {data.session.user.name}
          </h1>
          <p className="mt-2 text-amber-100/80">{data.session.user.email}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/admin/profile">
              <Button tone="secondary">{t("nav.profile")}</Button>
            </Link>
            <Link to="/admin/sessions">
              <Button tone="secondary">{t("nav.sessions")}</Button>
            </Link>
            <Link to="/admin/api-keys">
              <Button tone="secondary">{t("nav.apiKeys")}</Button>
            </Link>
          </div>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Stat label={t("dashboard.links")} value={data.summary.links} />
          <Stat label={t("dashboard.redirects")} value={data.summary.redirects} />
          <Stat label={t("dashboard.domains")} value={data.summary.domains} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="text-2xl font-black">{t("dashboard.links")}</h2>
          <LinkForm
            editing={editingLink}
            onCancel={() => setEditingLink(null)}
            onSaved={async () => {
              setEditingLink(null);
              await onChange();
            }}
            t={t}
          />
          <div className="mt-8 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-950/10 text-stone-600">
                  <th className="py-3">{t("table.slug")}</th>
                  <th className="py-3">{t("table.host")}</th>
                  <th className="py-3">{t("table.target")}</th>
                  <th className="py-3">{t("table.hits")}</th>
                  <th className="py-3">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.links.map((link) => (
                  <tr key={link.id} className="border-b border-stone-950/5">
                    <td className="py-3 font-black">{link.slug}</td>
                    <td className="py-3">{link.hostname}</td>
                    <td className="max-w-xs truncate py-3">{link.targetUrl}</td>
                    <td className="py-3">{link.hitCount}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => setEditingLink(link)}
                          tone="secondary"
                          type="button"
                        >
                          {t("forms.update")}
                        </Button>
                        <Button
                          onClick={async () => {
                            const api = getTreaty();
                            await api.admin.links({ id: link.id }).delete();
                            await onChange();
                          }}
                          tone="danger"
                          type="button"
                        >
                          {t("forms.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6">
          <Card>
            <h2 className="text-2xl font-black">{t("dashboard.domains")}</h2>
            <DomainForm onSaved={onChange} t={t} />
            <div className="mt-5 grid gap-3">
              {data.domains.map((domain) => (
                <div
                  className="rounded-2xl border border-stone-950/10 bg-white/70 p-4"
                  key={domain.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{domain.hostname}</p>
                      <p className="text-sm text-stone-600">
                        {domain.label ?? t("domains.noLabel")} ·{" "}
                        {domain.isPrimary ? t("domains.primary") : t("domains.secondary")} ·{" "}
                        {domain.isActive ? t("domains.active") : t("domains.inactive")}
                      </p>
                    </div>
                    <Button
                      onClick={async () => {
                        const api = getTreaty();
                        await api.admin.domains({ id: domain.id }).delete();
                        await onChange();
                      }}
                      tone="danger"
                      type="button"
                    >
                      {t("forms.delete")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="text-2xl font-black">{t("dashboard.invites")}</h2>
            <InviteForm onSaved={onChange} t={t} />
            <div className="mt-5 grid gap-3">
              {data.invites.map((invite) => (
                <a
                  className="break-all rounded-2xl border border-stone-950/10 bg-white/70 p-4 text-sm underline decoration-blue-700 underline-offset-4"
                  href={invite.inviteUrl}
                  key={invite.id}
                >
                  {invite.email}: {invite.inviteUrl}
                </a>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <Card>
        <h2 className="text-2xl font-black">{t("dashboard.recentRedirects")}</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-950/10 text-stone-600">
                <th className="py-3">{t("table.when")}</th>
                <th className="py-3">{t("table.host")}</th>
                <th className="py-3">{t("table.slug")}</th>
                <th className="py-3">{t("table.country")}</th>
                <th className="py-3">{t("table.referer")}</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr className="border-b border-stone-950/5" key={event.id}>
                  <td className="py-3">{new Date(event.createdAt).toLocaleString(locale)}</td>
                  <td className="py-3">{event.hostname}</td>
                  <td className="py-3 font-black">{event.slug}</td>
                  <td className="py-3">{event.country ?? t("table.direct")}</td>
                  <td className="max-w-xs truncate py-3">{event.referer ?? t("table.direct")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function LinkForm({
  editing,
  onCancel,
  onSaved,
  t,
}: {
  editing: DashboardData["links"][number] | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  t: ReturnType<typeof createTranslator>;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      hostname: editing?.hostname === "__default__" ? "" : (editing?.hostname ?? ""),
      isActive: editing?.isActive ?? true,
      notes: editing?.notes ?? "",
      preserveQueryParams: editing?.preserveQueryParams ?? false,
      slug: editing?.slug ?? "",
      statusCode: editing?.statusCode ?? 302,
      targetUrl: editing?.targetUrl ?? "",
      title: editing?.title ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const api = getTreaty();
        if (editing) {
          await api.admin.links({ id: editing.id }).patch(value);
        } else {
          await api.admin.links.post(value);
        }
        await onSaved();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
      }
    },
  });

  useEffect(() => {
    form.reset({
      hostname: editing?.hostname === "__default__" ? "" : (editing?.hostname ?? ""),
      isActive: editing?.isActive ?? true,
      notes: editing?.notes ?? "",
      preserveQueryParams: editing?.preserveQueryParams ?? false,
      slug: editing?.slug ?? "",
      statusCode: editing?.statusCode ?? 302,
      targetUrl: editing?.targetUrl ?? "",
      title: editing?.title ?? "",
    });
  }, [editing?.id]);

  return (
    <form
      className="mt-5 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field
          name="hostname"
          children={(field) => (
            <FieldLabel>
              {t("forms.hostname")}
              <Input
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t("forms.placeholderHostname")}
                value={field.state.value}
              />
            </FieldLabel>
          )}
        />
        <form.Field
          name="statusCode"
          children={(field) => (
            <FieldLabel>
              {t("forms.statusCode")}
              <Select
                onChange={(event) => field.handleChange(Number(event.target.value))}
                value={field.state.value}
              >
                <option value={302}>302 temporary</option>
                <option value={301}>301 permanent</option>
              </Select>
            </FieldLabel>
          )}
        />
      </div>
      <form.Field
        name="targetUrl"
        children={(field) => (
          <FieldLabel>
            {t("forms.destination")}
            <Input
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={t("forms.placeholderDestination")}
              required
              value={field.state.value}
            />
          </FieldLabel>
        )}
      />
      <form.Field
        name="slug"
        children={(field) => (
          <FieldLabel>
            {t("forms.slug")}
            <Input
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={t("forms.placeholderSlug")}
              value={field.state.value}
            />
          </FieldLabel>
        )}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field
          name="title"
          children={(field) => (
            <FieldLabel>
              {t("forms.title")}
              <Input onChange={(event) => field.handleChange(event.target.value)} value={field.state.value} />
            </FieldLabel>
          )}
        />
        <form.Field
          name="notes"
          children={(field) => (
            <FieldLabel>
              {t("forms.notes")}
              <TextArea onChange={(event) => field.handleChange(event.target.value)} value={field.state.value} />
            </FieldLabel>
          )}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field
          name="preserveQueryParams"
          children={(field) => (
            <label className="flex items-center gap-3 rounded-2xl bg-stone-950/5 p-3 text-sm font-bold">
              <input
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
                type="checkbox"
              />
              {t("forms.preserveQuery")}
            </label>
          )}
        />
        <form.Field
          name="isActive"
          children={(field) => (
            <label className="flex items-center gap-3 rounded-2xl bg-stone-950/5 p-3 text-sm font-bold">
              <input
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
                type="checkbox"
              />
              {t("forms.active")}
            </label>
          )}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">{editing ? t("forms.update") : t("forms.create")}</Button>
        {editing ? (
          <Button onClick={onCancel} tone="secondary" type="button">
            {t("forms.cancel")}
          </Button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{t(error)}</Notice> : null}
    </form>
  );
}

function DomainForm({
  onSaved,
  t,
}: {
  onSaved: () => Promise<void>;
  t: ReturnType<typeof createTranslator>;
}) {
  const form = useForm({
    defaultValues: {
      hostname: "",
      isActive: true,
      isPrimary: false,
      label: "",
    },
    onSubmit: async ({ value }) => {
      const api = getTreaty();
      await api.admin.domains.post(value);
      form.reset();
      await onSaved();
    },
  });

  return (
    <form
      className="mt-5 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="hostname"
        children={(field) => (
          <FieldLabel>
            {t("forms.hostname")}
            <Input onChange={(event) => field.handleChange(event.target.value)} required value={field.state.value} />
          </FieldLabel>
        )}
      />
      <form.Field
        name="label"
        children={(field) => (
          <FieldLabel>
            {t("forms.label")}
            <Input onChange={(event) => field.handleChange(event.target.value)} value={field.state.value} />
          </FieldLabel>
        )}
      />
      <form.Field
        name="isPrimary"
        children={(field) => (
          <label className="flex items-center gap-3 text-sm font-bold">
            <input checked={field.state.value} onChange={(event) => field.handleChange(event.target.checked)} type="checkbox" />
            {t("forms.primary")}
          </label>
        )}
      />
      <form.Field
        name="isActive"
        children={(field) => (
          <label className="flex items-center gap-3 text-sm font-bold">
            <input checked={field.state.value} onChange={(event) => field.handleChange(event.target.checked)} type="checkbox" />
            {t("forms.active")}
          </label>
        )}
      />
      <Button type="submit">{t("forms.create")}</Button>
    </form>
  );
}

function InviteForm({
  onSaved,
  t,
}: {
  onSaved: () => Promise<void>;
  t: ReturnType<typeof createTranslator>;
}) {
  const form = useForm({
    defaultValues: {
      email: "",
      expiresInDays: 7,
    },
    onSubmit: async ({ value }) => {
      const api = getTreaty();
      await api.admin.invites.post(value);
      form.reset();
      await onSaved();
    },
  });

  return (
    <form
      className="mt-5 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="email"
        children={(field) => (
          <FieldLabel>
            {t("forms.email")}
            <Input onChange={(event) => field.handleChange(event.target.value)} required type="email" value={field.state.value} />
          </FieldLabel>
        )}
      />
      <form.Field
        name="expiresInDays"
        children={(field) => (
          <FieldLabel>
            {t("forms.expiresInDays")}
            <Input min={1} max={30} onChange={(event) => field.handleChange(Number(event.target.value))} type="number" value={field.state.value} />
          </FieldLabel>
        )}
      />
      <Button type="submit">{t("forms.create")}</Button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 text-4xl font-black text-stone-950">{value}</p>
    </Card>
  );
}
