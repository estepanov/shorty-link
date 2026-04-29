import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	AdminFormRoot,
	FormFooter,
	FormGrid,
	FormSection,
} from "@/components/admin-forms";
import {
	Button,
	Card,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminInvite, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/invites/$id/edit")({
	component: EditInvite,
});

function EditInvite() {
	const { id } = Route.useParams();
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("invites.update");
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
	onSaved,
	roles,
	t,
}: {
	invite: AdminInvite;
	onSaved: () => Promise<void>;
	roles: AssignableRole[];
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	const getInitialExpiresInDays = () => {
		const remaining = Math.max(
			1,
			Math.ceil((invite.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
		);
		return Math.min(remaining, 30);
	};
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			email: invite.email,
			expiresInDays: getInitialExpiresInDays(),
			roleId: invite.roleId,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				await unwrap(
					await api.admin.invites({ id: invite.id }).patch({
						email: value.email,
						expiresInDays: value.expiresInDays,
						roleId: value.roleId,
					}),
				);
				await onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited invite changes.
	useEffect(() => {
		form.reset({
			email: invite.email,
			expiresInDays: getInitialExpiresInDays(),
			roleId: invite.roleId,
		});
	}, [invite.id]);

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<FieldGroup>
				<FormSection
					description={t("invites.recipientDescription")}
					title={t("invites.recipient")}
				>
					<form.Field name="email">
						{(field) => (
							<Field data-invalid={!field.state.meta.isValid}>
								<FieldLabel htmlFor={field.name}>{t("forms.email")}</FieldLabel>
								<Input
									aria-invalid={!field.state.meta.isValid}
									id={field.name}
									name={field.name}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									required
									type="email"
									value={field.state.value}
								/>
								<FieldError
									errors={field.state.meta.errors.map((message) => ({
										message: String(message),
									}))}
								/>
							</Field>
						)}
					</form.Field>
				</FormSection>
				<FormSection
					description={t("invites.accessDescription")}
					title={t("invites.access")}
				>
					<FormGrid>
						<form.Field name="roleId">
							{(field) => (
								<Field data-invalid={!field.state.meta.isValid}>
									<FieldLabel htmlFor={field.name}>
										{t("users.role")}
									</FieldLabel>
									<Select
										onValueChange={field.handleChange}
										value={field.state.value}
									>
										<SelectTrigger
											aria-invalid={!field.state.meta.isValid}
											id={field.name}
										>
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
									<FieldError
										errors={field.state.meta.errors.map((message) => ({
											message: String(message),
										}))}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="expiresInDays">
							{(field) => (
								<Field data-invalid={!field.state.meta.isValid}>
									<FieldLabel htmlFor={field.name}>
										{t("forms.expiresInDays")}
									</FieldLabel>
									<Input
										aria-invalid={!field.state.meta.isValid}
										id={field.name}
										max={30}
										min={1}
										name={field.name}
										onBlur={field.handleBlur}
										onChange={(event) =>
											field.handleChange(Number(event.target.value))
										}
										type="number"
										value={field.state.value}
									/>
									<FieldError
										errors={field.state.meta.errors.map((message) => ({
											message: String(message),
										}))}
									/>
								</Field>
							)}
						</form.Field>
					</FormGrid>
				</FormSection>
			</FieldGroup>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FormFooter>
				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting]}
				>
					{([canSubmit, isSubmitting]) => (
						<Button disabled={!canSubmit || isSubmitting} type="submit">
							{t("forms.update")}
						</Button>
					)}
				</form.Subscribe>
				<Link to="/admin/access/invites">
					<Button tone="secondary" type="button">
						{t("forms.cancel")}
					</Button>
				</Link>
			</FormFooter>
		</AdminFormRoot>
	);
}
