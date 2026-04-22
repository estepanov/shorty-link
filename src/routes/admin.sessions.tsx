import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell, Button, Card, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { createTranslator, defaultLocale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/sessions")({
  component: Sessions,
});

type SessionRecord = {
  id?: string;
  token: string;
  createdAt?: string | Date;
  expiresAt?: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function Sessions() {
  const { data: session } = authClient.useSession();
  const locale =
    (session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
  const t = createTranslator(locale);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const result = await authClient.listSessions();
    if (result.error) {
      setError(result.error.message ?? "errors.unknown");
      return;
    }
    setSessions((result.data ?? []) as SessionRecord[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AppShell locale={locale}>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <Card>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-4xl font-black">{t("sessions.title")}</h1>
              <p className="mt-2 text-stone-700">
                {t("sessions.description")}
              </p>
            </div>
            <Button
              onClick={async () => {
                await authClient.revokeOtherSessions();
                await refresh();
              }}
              tone="secondary"
              type="button"
            >
              {t("sessions.revokeOther")}
            </Button>
          </div>
          {error ? (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
          <div className="mt-6 grid gap-3">
            {sessions.map((item) => (
              <div
                className="rounded-2xl border border-stone-950/10 bg-white/70 p-4"
                key={item.token}
              >
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <p className="font-black">
                      {item.userAgent ?? t("sessions.unknownBrowser")}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">
                      {t("sessions.ip")} {item.ipAddress ?? t("sessions.unknown")} ·{" "}
                      {t("sessions.expires")}{" "}
                      {item.expiresAt
                        ? new Date(item.expiresAt).toLocaleString(locale)
                        : t("sessions.unknown")}
                    </p>
                  </div>
                  <Button
                    onClick={async () => {
                      await authClient.revokeSession({ token: item.token });
                      await refresh();
                    }}
                    tone="danger"
                    type="button"
                  >
                    {t("sessions.revoke")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
