import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell, Button, Card, FieldLabel, Input, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { createTranslator, defaultLocale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/api-keys")({
  component: ApiKeys,
});

type ApiKeyRecord = {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  enabled?: boolean | null;
  createdAt?: string | Date;
  expiresAt?: string | Date | null;
};

function ApiKeys() {
  const { data: session } = authClient.useSession();
  const locale =
    (session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      expiresInDays: 30,
      name: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setCreatedKey(null);
      const result = await authClient.apiKey.create({
        expiresIn: value.expiresInDays * 24 * 60 * 60,
        name: value.name,
      });

      if (result.error) {
        setError(result.error.message ?? "errors.unknown");
        return;
      }

      setCreatedKey((result.data as { key?: string } | null)?.key ?? null);
      form.reset();
      await refresh();
    },
  });

  async function refresh() {
    const result = await authClient.apiKey.list({
      query: {
        limit: 100,
        sortBy: "createdAt",
        sortDirection: "desc",
      },
    });
    if (result.error) {
      setError(result.error.message ?? "errors.unknown");
      return;
    }

    const data = result.data as { apiKeys?: ApiKeyRecord[] } | ApiKeyRecord[] | null;
    setKeys(Array.isArray(data) ? data : (data?.apiKeys ?? []));
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AppShell locale={locale}>
      <main className="mx-auto grid max-w-5xl gap-6 px-5 py-10">
        <Card>
          <h1 className="text-4xl font-black">{t("keys.title")}</h1>
          <p className="mt-2 text-stone-700">
            {t("keys.description")}
          </p>
          <form
            className="mt-6 grid gap-4 md:grid-cols-[1fr_12rem_auto]"
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
                  <Input onChange={(event) => field.handleChange(event.target.value)} required value={field.state.value} />
                </FieldLabel>
              )}
            />
            <form.Field
              name="expiresInDays"
              children={(field) => (
                <FieldLabel>
                  {t("forms.expiresInDays")}
                  <Input min={1} onChange={(event) => field.handleChange(Number(event.target.value))} type="number" value={field.state.value} />
                </FieldLabel>
              )}
            />
            <div className="flex items-end">
              <Button type="submit">{t("keys.create")}</Button>
            </div>
          </form>
          {createdKey ? (
            <div className="mt-4">
              <Notice tone="success">
                <strong>{t("keys.created")}</strong>
                <code className="mt-2 block break-all rounded-xl bg-stone-950 px-3 py-2 text-amber-100">
                  {createdKey}
                </code>
              </Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </Card>
        <Card>
          <div className="grid gap-3">
            {keys.map((key) => (
              <ApiKeyRow key={key.id} item={key} onChange={refresh} t={t} />
            ))}
          </div>
        </Card>
      </main>
    </AppShell>
  );
}

function ApiKeyRow({
  item,
  onChange,
  t,
}: {
  item: ApiKeyRecord;
  onChange: () => Promise<void>;
  t: ReturnType<typeof createTranslator>;
}) {
  const [editing, setEditing] = useState(false);
  const form = useForm({
    defaultValues: {
      name: item.name ?? "",
    },
    onSubmit: async ({ value }) => {
      await authClient.apiKey.update({
        keyId: item.id,
        name: value.name,
      });
      setEditing(false);
      await onChange();
    },
  });

  return (
    <div className="rounded-2xl border border-stone-950/10 bg-white/70 p-4">
      {editing ? (
        <form
          className="flex flex-col gap-3 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            children={(field) => (
              <Input
                aria-label={t("keys.nameAria")}
                onChange={(event) => field.handleChange(event.target.value)}
                value={field.state.value}
              />
            )}
          />
          <Button type="submit">{t("forms.save")}</Button>
          <Button onClick={() => setEditing(false)} tone="secondary" type="button">
            {t("forms.cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <p className="font-black">{item.name ?? t("keys.unnamed")}</p>
            <p className="text-sm text-stone-600">
              {item.prefix ?? "sl_"}
              {item.start ?? "••••"} ·{" "}
              {item.enabled === false ? t("keys.disabled") : t("keys.enabled")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} tone="secondary" type="button">
              {t("keys.edit")}
            </Button>
            <Button
              onClick={async () => {
                await authClient.apiKey.delete({ keyId: item.id });
                await onChange();
              }}
              tone="danger"
              type="button"
            >
              {t("keys.delete")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
