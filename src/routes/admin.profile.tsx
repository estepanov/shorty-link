import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell, Button, Card, FieldLabel, Input, Notice, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { getTreaty } from "@/lib/eden";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";

export const Route = createFileRoute("/admin/profile")({
  component: Profile,
});

function Profile() {
  const { data: session, refetch } = authClient.useSession();
  const locale =
    (session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      email: session?.user.email ?? "",
      locale,
      name: session?.user.name ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setNotice(null);
      try {
        const api = getTreaty();
        await api.admin.profile.patch(value);
        await refetch();
        setNotice("profile.saved");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
      }
    },
  });

  if (!session) {
    return (
      <AppShell locale={locale}>
        <main className="mx-auto max-w-3xl px-5 py-10">
          <Notice tone="error">{t("errors.unauthorized")}</Notice>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell locale={locale}>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <Card>
          <h1 className="text-4xl font-black">{t("profile.title")}</h1>
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
            <Button type="submit">{t("forms.save")}</Button>
          </form>
          {notice ? (
            <div className="mt-4">
              <Notice tone="success">{t(notice)}</Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <Notice tone="error">{t(error)}</Notice>
            </div>
          ) : null}
        </Card>
      </main>
    </AppShell>
  );
}
