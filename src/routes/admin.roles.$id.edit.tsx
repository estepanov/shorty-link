import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DeleteConfirmationDialog,
	FieldLabel,
	Input,
	MultiCombobox,
	Notice,
	TextArea,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminDomain,
	AdminRoleDetail,
	LinkListItem,
	PermissionCatalog,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/roles/$id/edit")({
	component: EditRole,
});

function EditRole() {
	const { id } = Route.useParams();
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isAuthPending } =
		useRequirePermission("roles.manage");
	const [role, setRole] = useState<AdminRoleDetail | null>(null);
	const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
	const [domains, setDomains] = useState<AdminDomain[]>([]);
	const [links, setLinks] = useState<LinkListItem[]>([]);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch only when the role id or authenticated user identity changes.
	useEffect(() => {
		if (!session) {
			return;
		}

		async function load() {
			setError(null);
			try {
				const api = getTreaty();
				const [nextRole, nextCatalog, nextDomains, nextLinks] =
					await Promise.all([
						unwrap<AdminRoleDetail>(await api.admin.roles({ id }).get()),
						unwrap<PermissionCatalog>(await api.admin.permissions.get()),
						unwrap<AdminDomain[]>(await api.admin.domains.get()),
						unwrap<{ items: LinkListItem[] }>(
							await api.admin.links.get({ query: { pageSize: 100 } }),
						).then((r) => r.items),
					]);
				setRole(nextRole);
				setCatalog(nextCatalog);
				setDomains(nextDomains);
				setLinks(nextLinks);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void load();
	}, [id, session?.user.id]);

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
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<h1 className="text-4xl font-medium">{t("pages.editRole")}</h1>
					{role && !role.isSystem ? (
						<DeleteConfirmationDialog
							title={t("forms.confirmDelete")}
							description={t("forms.confirmDeleteDescription")}
							confirmLabel={t("forms.delete")}
							cancelLabel={t("forms.cancel")}
							onConfirm={async () => {
								setError(null);
								try {
									const api = getTreaty();
									await unwrap(await api.admin.roles({ id }).delete());
									await router.navigate({ to: "/admin/access/roles" });
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
					) : null}
				</div>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{role && catalog ? (
					<RoleEditor
						catalog={catalog}
						domains={domains}
						links={links}
						onSaved={async () => {
							await router.navigate({ to: "/admin/access/roles" });
						}}
						role={role}
						t={t}
					/>
				) : (
					<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
				)}
			</Card>
		</div>
	);
}

function RoleEditor({
	catalog,
	domains,
	links,
	onSaved,
	role,
	t,
}: {
	catalog: PermissionCatalog;
	domains: AdminDomain[];
	links: LinkListItem[];
	onSaved: () => Promise<void>;
	role: AdminRoleDetail;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	const [name, setName] = useState(role.name);
	const [description, setDescription] = useState(role.description ?? "");
	const [permissions, setPermissions] = useState<Set<Permission>>(
		new Set(role.permissions as Permission[]),
	);
	const [domainScope, setDomainScope] = useState<Set<string>>(
		new Set(role.domainScopeIds),
	);
	const [linkScope, setLinkScope] = useState<Set<string>>(
		new Set(role.linkScopeIds),
	);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	function togglePermission(value: Permission) {
		setPermissions((prev) => {
			const next = new Set(prev);
			if (next.has(value)) {
				next.delete(value);
			} else {
				next.add(value);
			}
			return next;
		});
	}

	function toggleSetItem(set: Set<string>, value: string) {
		const next = new Set(set);
		if (next.has(value)) {
			next.delete(value);
		} else {
			next.add(value);
		}
		return next;
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		event.stopPropagation();
		setError(null);
		setSubmitting(true);
		try {
			const body = {
				name,
				description: description.trim() || undefined,
				permissions: [...permissions] as string[],
				domainScopeIds: [...domainScope],
				linkScopeIds: [...linkScope],
			};
			const api = getTreaty();
			await unwrap(await api.admin.roles({ id: role.id }).patch(body));
			await onSaved();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		} finally {
			setSubmitting(false);
		}
	}

	const groupOrder = Object.keys(catalog.groups);

	return (
		<form className="mt-6 grid gap-5" onSubmit={handleSubmit}>
			<FieldLabel>
				{t("forms.name")}
				<Input
					maxLength={64}
					onChange={(event) => setName(event.target.value)}
					placeholder={t("roles.namePlaceholder")}
					required
					value={name}
				/>
			</FieldLabel>
			<FieldLabel>
				{t("forms.notes")}
				<TextArea
					onChange={(event) => setDescription(event.target.value)}
					placeholder={t("roles.descriptionPlaceholder")}
					value={description}
				/>
			</FieldLabel>

			<div>
				<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
					{t("roles.permissions")}
				</p>
				<p className="mt-1 text-xs text-muted-foreground/80">
					{t("roles.permissionsHelp")}
				</p>
				<div className="mt-3 grid gap-4 md:grid-cols-2">
					{groupOrder.map((groupKey) => (
						<div
							className="rounded-md border border-border bg-muted/40 p-3"
							key={groupKey}
						>
							<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								{t(`roles.permissionGroup.${groupKey}`)}
							</p>
							<div className="grid gap-1">
								{catalog.groups[groupKey].map((perm) => (
									<label className="flex items-center gap-2 text-sm" key={perm}>
										<input
											checked={permissions.has(perm as Permission)}
											className="accent-primary"
											onChange={() => togglePermission(perm as Permission)}
											type="checkbox"
										/>
										{t(`permissions.${perm}`)}
									</label>
								))}
							</div>
						</div>
					))}
				</div>
			</div>

			<div>
				<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
					{t("roles.scopeDomains")}
				</p>
				<p className="mt-1 text-xs text-muted-foreground/80">
					{t("roles.scopeDomainsHelp")}
				</p>
				<div className="mt-3">
					<MultiCombobox
						options={domains.map((domain) => ({
							value: domain.id,
							label: domain.label
								? `${domain.hostname} (${domain.label})`
								: domain.hostname,
						}))}
						selected={[...domainScope]}
						onChange={(vals) => setDomainScope(new Set(vals))}
						placeholder={t("roles.scopeDomains")}
						searchPlaceholder="Search domains..."
						emptyMessage="No domains found."
					/>
				</div>
			</div>

			<div>
				<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
					{t("roles.scopeLinks")}
				</p>
				<p className="mt-1 text-xs text-muted-foreground/80">
					{t("roles.scopeLinksHelp")}
				</p>
				<div className="mt-3">
					<MultiCombobox
						options={links.map((link) => ({
							value: link.id,
							label: link.title
								? `${link.hostname === "__default__" ? "" : `${link.hostname}/`}${link.slug} — ${link.title}`
								: `${link.hostname === "__default__" ? "" : `${link.hostname}/`}${link.slug}`,
						}))}
						selected={[...linkScope]}
						onChange={(vals) => setLinkScope(new Set(vals))}
						placeholder={t("roles.scopeLinks")}
						searchPlaceholder="Search links..."
						emptyMessage="No links found."
					/>
				</div>
			</div>

			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<div className="flex gap-2">
				<Button disabled={submitting} type="submit">
					{t("forms.update")}
				</Button>
				<Link to="/admin/access/roles">
					<Button tone="secondary" type="button">
						{t("forms.cancel")}
					</Button>
				</Link>
			</div>
		</form>
	);
}
