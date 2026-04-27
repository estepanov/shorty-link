import { useForm } from "@tanstack/react-form";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	AdminFormRoot,
	FormFooter,
	FormGrid,
	ToggleTile,
} from "@/components/admin-forms";
import {
	Button,
	Card,
	DeleteConfirmationDialog,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type { AdminUserDetail, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/users/$id/edit")({
	component: EditUser,
});

function EditUser() {
	const { id } = Route.useParams();
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isPermissionPending } =
		useRequirePermission("users.write");
	const [userData, setUserData] = useState<AdminUserDetail | null>(null);
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when user id or authenticated user identity changes.
	useEffect(() => {
		if (!session || isPermissionPending || !isAuthorized) {
			return;
		}

		async function load() {
			setError(null);
			try {
				const api = getTreaty();
				const [nextUser, nextRoles] = await Promise.all([
					unwrap<AdminUserDetail>(await api.admin.users({ id }).get()),
					unwrap<AssignableRole[]>(await api.admin.roles.assignable.get()),
				]);
				setUserData(nextUser);
				setRoles(nextRoles);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, isAuthorized, isPermissionPending, session?.user.id]);

	if (isPending || isPermissionPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const isSelf = userData?.id === session.user.id;

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<h1 className="flex flex-wrap items-center gap-2 text-4xl font-medium">
						{t("pages.editUser")}
						{isSelf ? (
							<span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
								{t("users.you")}
							</span>
						) : null}
					</h1>
					{isSelf ? null : (
						<DeleteConfirmationDialog
							title={t("forms.confirmDelete")}
							description={t("forms.confirmDeleteDescription")}
							confirmLabel={t("forms.delete")}
							cancelLabel={t("forms.cancel")}
							onConfirm={async () => {
								setError(null);
								try {
									const api = getTreaty();
									await unwrap(await api.admin.users({ id }).delete());
									await router.navigate({ to: "/admin/access/users" });
								} catch (nextError) {
									setError(
										nextError instanceof Error
											? nextError.message
											: "errors.unknown",
									);
								}
							}}
						>
							<Button tone="danger" type="button">
								{t("forms.delete")}
							</Button>
						</DeleteConfirmationDialog>
					)}
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{userData && roles.length > 0 ? (
					<EditUserForm
						key={userData.id}
						user={userData}
						roles={roles}
						onError={setError}
						isSelf={isSelf}
					/>
				) : (
					<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
				)}
			</Card>
		</div>
	);
}

function EditUserForm({
	user,
	roles,
	onError,
	isSelf,
}: {
	user: AdminUserDetail;
	roles: AssignableRole[];
	onError: (message: string | null) => void;
	isSelf: boolean;
}) {
	const router = useRouter();
	const { t } = useAdminAuthGuard();
	const originalRoleId = user.roleId;

	const form = useForm({
		defaultValues: {
			name: user.name,
			email: user.email,
			locale: user.locale,
			roleId: user.roleId,
			isActive: user.isActive,
		},
		onSubmit: async ({ value }) => {
			onError(null);
			try {
				const api = getTreaty();
				await unwrap(
					await api.admin.users({ id: user.id }).patch({
						name: value.name,
						email: value.email,
						locale: value.locale,
						isActive: value.isActive,
					}),
				);
				if (value.roleId && value.roleId !== originalRoleId) {
					await unwrap(
						await api.admin.users({ id: user.id }).role.patch({
							roleId: value.roleId,
						}),
					);
				}
				await router.navigate({ to: "/admin/access/users" });
			} catch (nextError) {
				onError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="name">
				{(field) => (
					<FieldLabel>
						{t("forms.name")}
						<Input
							onChange={(event) => field.handleChange(event.target.value)}
							required
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<form.Field name="email">
				{(field) => (
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
			</form.Field>
			<FormGrid className="sm:grid-cols-2">
				<form.Field name="locale">
					{(field) => (
						<FieldLabel>
							{t("forms.locale")}
							<Select
								onValueChange={(val) => field.handleChange(val)}
								value={field.state.value}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="en">English (en)</SelectItem>
									<SelectItem value="es">Español (es)</SelectItem>
								</SelectContent>
							</Select>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="roleId">
					{(field) => (
						<FieldLabel>
							{t("users.role")}
							<Select
								onValueChange={(val) => field.handleChange(val)}
								value={field.state.value}
							>
								<SelectTrigger className="w-full">
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
					)}
				</form.Field>
			</FormGrid>
			<form.Field name="isActive">
				{(field) => (
					<ToggleTile
						checked={field.state.value}
						disabled={isSelf}
						onCheckedChange={field.handleChange}
						tone="green"
					>
						{t("forms.active")}
					</ToggleTile>
				)}
			</form.Field>
			<FormFooter>
				<Button className="sm:min-w-32" type="submit">
					{t("forms.save")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}
