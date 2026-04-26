import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import {
	useAdminAuthGuard,
	useAuthContext,
	useRequirePermission,
} from "@/lib/admin-auth";
import type { AdminInvite, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/invites/$id/edit")({
	component: EditInvite,
});

function EditInvite() {
	const { id } = Route.useParams();
	const router = useRouter();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("invites.update");
	const { hasPermission } = useAuthContext();
	const [invite, setInvite] = useState<AdminInvite | null>(null);
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when id or session identity changes.
	useEffect(() => {
		if (!session || !isAuthorized) {
			return;
		}

		async function load() {
			setError(null);
			try {
				const api = getTreaty();
				const [nextInvite, nextRoles] = await Promise.all([
					unwrap<AdminInvite>(await api.admin.invites({ id }).get()),
					unwrap<AssignableRole[]>(await api.admin.roles.assignable.get()),
				]);
				setInvite(nextInvite);
				setRoles(nextRoles);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, isAuthorized, session?.user.id]);

	if (isPending || isAuthPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<h1 className="text-4xl font-medium">{t("pages.editInvite")}</h1>
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{invite ? (
					<InviteEditor
						invite={invite}
						locale={locale}
						onSaved={async () => {
							await router.navigate({ to: "/admin/access/invites" });
						}}
						roles={roles}
						t={t}
					/>
				) : (
					<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
				)}
			</Card>
		</div>
	);
}

function InviteEditor({
	invite,
	locale,
	onSaved,
	roles,
	t,
}: {
	invite: AdminInvite;
	locale: string;
	onSaved: () => Promise<void>;
	roles: AssignableRole[];
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	const [email, setEmail] = useState(invite.email);
	const [roleId, setRoleId] = useState(invite.roleId);
	const [expiresInDays, setExpiresInDays] = useState(() => {
		const remaining = Math.max(
			1,
			Math.ceil((invite.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
		);
		return Math.min(remaining, 30);
	});
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		event.stopPropagation();
		setError(null);
		setSubmitting(true);
		try {
			const api = getTreaty();
			await unwrap(
				await api.admin.invites({ id: invite.id }).patch({
					email,
					roleId,
					expiresInDays,
				}),
			);
			await onSaved();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
			<FieldLabel>
				{t("forms.email")}
				<Input
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</FieldLabel>
			<div className="grid gap-4 md:grid-cols-2">
				<FieldLabel>
					{t("users.role")}
					<Select onValueChange={setRoleId} value={roleId}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{roles.map((role) => (
								<SelectItem key={role.id} value={role.id}>
									{role.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</FieldLabel>
				<FieldLabel>
					{t("forms.expiresInDays")}
					<Input
						max={30}
						min={1}
						onChange={(event) => setExpiresInDays(Number(event.target.value))}
						type="number"
						value={expiresInDays}
					/>
				</FieldLabel>
			</div>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<div className="flex gap-2">
				<Button disabled={submitting} type="submit">
					{t("forms.update")}
				</Button>
				<Link to="/admin/access/invites">
					<Button tone="secondary" type="button">
						{t("forms.cancel")}
					</Button>
				</Link>
			</div>
		</form>
	);
}
