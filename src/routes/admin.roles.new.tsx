import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AdminFormRoot, FormFooter } from "@/components/admin-forms";
import {
	Button,
	Card,
	Input,
	MultiCombobox,
	Notice,
	TextArea,
} from "@/components/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@/components/ui/field";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminDomain,
	LinkListItem,
	PermissionCatalog,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/roles/new")({
	component: NewRole,
});

function NewRole() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("roles.create");
	const router = useRouter();
	const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
	const [domains, setDomains] = useState<AdminDomain[]>([]);
	const [links, setLinks] = useState<LinkListItem[]>([]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: load data when session identity changes.
	useEffect(() => {
		if (!session) return;
		void (async () => {
			try {
				const api = getTreaty();
				const [nextCatalog, nextDomains, nextLinks] = await Promise.all([
					unwrap<PermissionCatalog>(await api.admin.permissions.get()),
					unwrap<AdminDomain[]>(await api.admin.domains.get()),
					unwrap<{ items: LinkListItem[] }>(
						await api.admin.links.get({ query: { pageSize: 100 } }),
					).then((r) => r.items),
				]);
				setCatalog(nextCatalog);
				setDomains(nextDomains);
				setLinks(nextLinks);
			} catch {
				// silent fail; form will render without data
			}
		})();
	}, [session?.user.id]);

	if (isPending || isAuthPending) {
		return (
			<div className="mx-auto w-full max-w-3xl">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto w-full max-w-3xl">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	if (!isAuthorized) {
		return (
			<div className="mx-auto w-full max-w-3xl">
				<Notice tone="error">{t("errors.permissionDenied")}</Notice>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<h1 className="text-4xl font-medium">{t("pages.newRole")}</h1>
				{catalog ? (
					<RoleCreateForm
						catalog={catalog}
						domains={domains}
						links={links}
						onSaved={async () => {
							await router.navigate({ to: "/admin/access/roles" });
						}}
						t={t}
					/>
				) : (
					<p className="mt-6 text-sm text-muted-foreground">
						{t("loading.app")}
					</p>
				)}
			</Card>
		</div>
	);
}

function RoleCreateForm({
	catalog,
	domains,
	links,
	onSaved,
	t,
}: {
	catalog: PermissionCatalog;
	domains: AdminDomain[];
	links: LinkListItem[];
	onSaved: () => Promise<void>;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			description: "",
			domainScopeIds: [] as string[],
			linkScopeIds: [] as string[],
			name: "",
			permissions: ["sessions.manage" as Permission],
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				await unwrap(
					await api.admin.roles.post({
						description: value.description.trim() || undefined,
						domainScopeIds: value.domainScopeIds,
						linkScopeIds: value.linkScopeIds,
						name: value.name,
						permissions: value.permissions as string[],
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

	const groupOrder = Object.keys(catalog.groups);

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<FieldGroup>
				<FieldSet className="rounded-lg border border-border/70 bg-muted/25 p-4">
					<FieldLegend>{t("roles.details")}</FieldLegend>
					<FieldDescription>{t("roles.detailsHelp")}</FieldDescription>
					<form.Field name="name">
						{(field) => (
							<Field data-invalid={!field.state.meta.isValid}>
								<FieldLabel htmlFor={field.name}>{t("forms.name")}</FieldLabel>
								<Input
									aria-invalid={!field.state.meta.isValid}
									id={field.name}
									maxLength={64}
									name={field.name}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									placeholder={t("roles.namePlaceholder")}
									required
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
					<form.Field name="description">
						{(field) => (
							<Field data-invalid={!field.state.meta.isValid}>
								<FieldLabel htmlFor={field.name}>{t("forms.notes")}</FieldLabel>
								<TextArea
									aria-invalid={!field.state.meta.isValid}
									id={field.name}
									name={field.name}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									placeholder={t("roles.descriptionPlaceholder")}
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
				</FieldSet>

				<form.Field name="permissions">
					{(field) => (
						<FieldSet className="rounded-lg border border-border/70 bg-muted/25 p-4">
							<FieldLegend>{t("roles.permissions")}</FieldLegend>
							<FieldDescription>{t("roles.permissionsHelp")}</FieldDescription>
							<div className="grid gap-4 md:grid-cols-2">
								{groupOrder.map((groupKey) => (
									<div
										className="rounded-md border border-border bg-background/70 p-3"
										key={groupKey}
									>
										<FieldTitle className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
											{t(`roles.permissionGroup.${groupKey}`)}
										</FieldTitle>
										<FieldGroup data-slot="checkbox-group" className="gap-2">
											{catalog.groups[groupKey].map((perm) => {
												const value = perm as Permission;
												const id = `role-permission-${perm.replace(/\./g, "-")}`;
												const checked = field.state.value.includes(value);

												return (
													<Field key={perm} orientation="horizontal">
														<Checkbox
															checked={checked}
															id={id}
															onCheckedChange={(nextChecked) => {
																field.handleChange(
																	nextChecked === true
																		? [...field.state.value, value]
																		: field.state.value.filter(
																				(item) => item !== value,
																			),
																);
															}}
														/>
														<FieldLabel
															className="font-normal text-sm"
															htmlFor={id}
														>
															{t(`permissions.${perm}`)}
														</FieldLabel>
													</Field>
												);
											})}
										</FieldGroup>
									</div>
								))}
							</div>
						</FieldSet>
					)}
				</form.Field>

				<form.Field name="domainScopeIds">
					{(field) => (
						<FieldSet className="rounded-lg border border-border/70 bg-muted/25 p-4">
							<FieldLegend>{t("roles.scopeDomains")}</FieldLegend>
							<FieldDescription>{t("roles.scopeDomainsHelp")}</FieldDescription>
							<MultiCombobox
								emptyMessage="No domains found."
								onChange={field.handleChange}
								options={domains.map((domain) => ({
									label: domain.label
										? `${domain.hostname} (${domain.label})`
										: domain.hostname,
									value: domain.id,
								}))}
								placeholder={t("roles.scopeDomains")}
								searchPlaceholder="Search domains..."
								selected={field.state.value}
							/>
						</FieldSet>
					)}
				</form.Field>

				<form.Field name="linkScopeIds">
					{(field) => (
						<FieldSet className="rounded-lg border border-border/70 bg-muted/25 p-4">
							<FieldLegend>{t("roles.scopeLinks")}</FieldLegend>
							<FieldDescription>{t("roles.scopeLinksHelp")}</FieldDescription>
							<MultiCombobox
								emptyMessage="No links found."
								onChange={field.handleChange}
								options={links.map((link) => ({
									label: link.title
										? `${link.hostname === "__default__" ? "" : `${link.hostname}/`}${link.slug} - ${link.title}`
										: `${link.hostname === "__default__" ? "" : `${link.hostname}/`}${link.slug}`,
									value: link.id,
								}))}
								placeholder={t("roles.scopeLinks")}
								searchPlaceholder="Search links..."
								selected={field.state.value}
							/>
						</FieldSet>
					)}
				</form.Field>
			</FieldGroup>

			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FormFooter>
				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting]}
				>
					{([canSubmit, isSubmitting]) => (
						<Button disabled={!canSubmit || isSubmitting} type="submit">
							{t("forms.create")}
						</Button>
					)}
				</form.Subscribe>
				<Link to="/admin/access/roles">
					<Button tone="secondary" type="button">
						{t("forms.cancel")}
					</Button>
				</Link>
			</FormFooter>
		</AdminFormRoot>
	);
}
