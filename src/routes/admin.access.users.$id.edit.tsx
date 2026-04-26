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
	const [originalRoleId, setOriginalRoleId] = useState<string>("");

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
				setOriginalRoleId(nextUser.roleId);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, isAuthorized, isPermissionPending, session?.user.id]);

	const form = useForm({
		defaultValues: {
			name: userData?.name ?? "",
			email: userData?.email ?? "",
			locale: userData?.locale ?? "en",
			roleId: userData?.roleId ?? "",
			isActive: userData?.isActive ?? true,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				await unwrap(
					await api.admin.users({ id }).patch({
						name: value.name,
						email: value.email,
						locale: value.locale,
						isActive: value.isActive,
					}),
				);
				if (value.roleId !== originalRoleId) {
					await unwrap(
						await api.admin.users({ id }).role.patch({
							roleId: value.roleId,
						}),
					);
				}
				await router.navigate({ to: "/admin/access/users" });
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited user identity changes.
	useEffect(() => {
		if (userData) {
			form.reset({
				name: userData.name,
				email: userData.email,
				locale: userData.locale,
				roleId: userData.roleId,
				isActive: userData.isActive,
			});
		}
	}, [userData?.id]);

	if (isPending || isPermissionPending) {
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
					<h1 className="text-4xl font-medium">{t("pages.editUser")}</h1>
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
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{userData && roles.length > 0 ? (
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
									onCheckedChange={field.handleChange}
									tone="green"
								>
									{t("forms.active")}
								</ToggleTile>
							)}
						</form.Field>
						{error ? <Notice tone="error">{t(error)}</Notice> : null}
						<FormFooter>
							<Button className="sm:min-w-32" type="submit">
								{t("forms.save")}
							</Button>
						</FormFooter>
					</AdminFormRoot>
				) : (
					<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
				)}
			</Card>
		</div>
	);
}
