import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { InviteForm, type CreatedInvite } from "@/components/admin-forms";
import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";

export const Route = createFileRoute("/admin/invites/new")({
  component: NewInvite,
});

function NewInvite() {
  const { session, isPending, t } = useAdminAuthGuard();
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);

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
          className="text-sm font-black text-blue-800 underline underline-offset-4 dark:text-blue-300"
          to="/admin"
        >
          {t("pages.backDashboard")}
        </Link>
        <h1 className="mt-4 text-4xl font-black">{t("pages.newInvite")}</h1>
        {createdInvite ? (
          <div className="mt-4">
            <Notice tone="success">
              <strong>{t("invites.created")}</strong>
              <a
                className="mt-2 block break-all underline underline-offset-4"
                href={createdInvite.inviteUrl}
              >
                {createdInvite.inviteUrl}
              </a>
            </Notice>
          </div>
        ) : null}
        <InviteForm onSaved={setCreatedInvite} t={t} />
      </Card>
    </div>
  );
}
