import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LinkForm } from "@/components/admin-forms";
import { Button, Card, Notice } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type { AdminDomain, AdminLink } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/links/$id/edit")({
  component: EditLink,
});

function EditLink() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { session, isPending, t } = useAdminAuthGuard();
  const [domains, setDomains] = useState<AdminDomain[] | null>(null);
  const [link, setLink] = useState<AdminLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    async function loadLink() {
      setError(null);
      try {
        const api = getTreaty();
        const [nextDomains, nextLink] = await Promise.all([
          unwrap<AdminDomain[]>(await api.admin.domains.get()),
          unwrap<AdminLink>(await api.admin.links({ id }).get()),
        ]);
        setDomains(nextDomains);
        setLink(nextLink);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "errors.unknown");
      }
    }

    void loadLink();
  }, [id, session?.user.id]);

  if (isPending) {
    return <Card>{t("loading.app")}</Card>;
  }

  if (!session) {
    return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <Link
          className="text-sm font-black text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
          to="/admin"
        >
          {t("pages.backDashboard")}
        </Link>
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <h1 className="text-4xl font-black">{t("pages.editLink")}</h1>
          <Button
            onClick={async () => {
              setError(null);
              try {
                const api = getTreaty();
                await unwrap(await api.admin.links({ id }).delete());
                await router.navigate({ to: "/admin" });
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : "errors.unknown");
              }
            }}
            tone="danger"
            type="button"
          >
            {t("forms.delete")}
          </Button>
        </div>
        {error ? (
          <div className="mt-4">
            <Notice tone="error">{t(error)}</Notice>
          </div>
        ) : null}
        {domains && link ? (
          <LinkForm
            domains={domains}
            initialLink={link}
            onSaved={() => {
              void router.navigate({ to: "/admin" });
            }}
            t={t}
          />
        ) : (
          <p className="mt-6 text-stone-600 dark:text-stone-300">
            {t("loading.dashboard")}
          </p>
        )}
      </Card>
    </div>
  );
}
