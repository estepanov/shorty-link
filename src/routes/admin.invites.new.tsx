import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { InviteForm } from "@/components/admin-forms";
import { Card, Notice } from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/invites/new")({
	component: NewInvite,
});

function NewInvite() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const router = useRouter();
	const [roles, setRoles] = useState<AssignableRole[]>([]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: load roles when session identity changes.
	useEffect(() => {
		if (!session) return;
		void (async () => {
			try {
				const api = getTreaty();
				const next = await unwrap<AssignableRole[]>(
					await api.admin.roles.assignable.get(),
				);
				setRoles(next);
			} catch {
				// silent fail; InviteForm will render without roles
			}
		})();
	}, [session?.user.id]);

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!hasPermission("invites.manage")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<div className="mx-auto w-full max-w-4xl animate-fade-up">
			<Card className="p-5 sm:p-7">
				<div className="flex flex-col gap-2 border-b border-border/70 pb-5">
					<p className="eyebrow">{t("nav.access")}</p>
					<h1 className="text-3xl font-medium sm:text-4xl">
						{t("pages.newInvite")}
					</h1>
				</div>
				<InviteForm
					onSaved={async () => {
						await router.navigate({ to: "/admin/access/invites" });
					}}
					roles={roles}
					t={t}
				/>
			</Card>
		</div>
	);
}
