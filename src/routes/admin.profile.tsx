import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, FieldLabel, Input, Notice, Select } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";
import { supportedLocales } from "@/lib/i18n";

export const Route = createFileRoute("/admin/profile")({
  component: Profile,
});

function Profile() {
  const { session, isPending, locale, refetch, t } = useAdminAuthGuard();
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
        await unwrap(await api.admin.profile.patch(value));
        await refetch();
        setNotice("profile.saved");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
      }
    },
  });

  useEffect(() => {
    if (!session) {
      return;
    }

    form.reset({
      email: session.user.email,
      locale,
      name: session.user.name,
    });
  }, [locale, session?.user.email, session?.user.id, session?.user.name]);

  if (isPending) {
    return <Card>{t("loading.app")}</Card>;
  }

  if (!session) {
    return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
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
        <div className="mt-8 flex flex-wrap gap-3 border-t border-stone-950/10 pt-6 dark:border-white/10">
          <Link
            className="text-sm font-bold text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
            to="/admin/sessions"
          >
            {t("nav.sessions")}
          </Link>
          <Link
            className="text-sm font-bold text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
            to="/admin/api-keys"
          >
            {t("nav.apiKeys")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
