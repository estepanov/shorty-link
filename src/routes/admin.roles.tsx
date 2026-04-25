import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	TextArea,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type {
	AdminDomain,
	AdminRole,
	AdminRoleDetail,
	LinkListItem,
	PermissionCatalog,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin/roles")({
	component: RolesPage,
});

type RoleEditorState = {
	mode: "create" | "edit";
	role: AdminRoleDetail | null;
};

function RolesPage() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const [roles, setRoles] = useState<AdminRole[]>([]);
	const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
	const [domains, setDomains] = useState<AdminDomain[]>([]);
	const [links, setLinks] = useState<LinkListItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [editor, setEditor] = useState<RoleEditorState | null>(null);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [nextRoles, nextCatalog, nextDomains, nextLinks] =
				await Promise.all([
					unwrap<AdminRole[]>(await api.admin.roles.get()),
					unwrap<PermissionCatalog>(await api.admin.permissions.get()),
					unwrap<AdminDomain[]>(await api.admin.domains.get()),
					unwrap<{ items: LinkListItem[] }>(
						await api.admin.links.get({ query: { pageSize: 100 } }),
					).then((r) => r.items),
				]);
			setRoles(nextRoles);
			setCatalog(nextCatalog);
			setDomains(nextDomains);
			setLinks(nextLinks);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session identity changes.
	useEffect(() => {
		if (session) {
			void refresh();
		}
	}, [session?.user.id]);

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!hasPermission("roles.manage")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	async function openCreate() {
		setEditor({ mode: "create", role: null });
	}

	async function openEdit(roleId: string) {
		setError(null);
		try {
			const api = getTreaty();
			const detail = await unwrap<AdminRoleDetail>(
				await api.admin.roles({ id: roleId }).get(),
			);
			setEditor({ mode: "edit", role: detail });
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	async function deleteRole(roleId: string) {
		setError(null);
		try {
			const api = getTreaty();
			await unwrap(await api.admin.roles({ id: roleId }).delete());
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<Link
					className="text-sm font-black text-blue-800 underline underline-offset-4 dark:text-blue-300"
					to="/admin"
				>
					{t("pages.backDashboard")}
				</Link>
				<h1 className="mt-4 text-4xl font-black">{t("roles.title")}</h1>
				<p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
					{t("roles.description")}
				</p>
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				{hasPermission("roles.manage") ? (
					<div className="mt-4">
						<Button onClick={openCreate} type="button">
							{t("roles.create")}
						</Button>
					</div>
				) : null}
			</Card>

			<Card>
				<div className="grid gap-3">
					{roles.length ? (
						roles.map((role) => (
							<div
								key={role.id}
								className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
							>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="flex-1">
										<p className="font-black">
											{role.name}
											{role.isSystem ? (
												<span className="ml-2 inline-flex rounded-full bg-stone-200 px-2 py-0.5 text-xs font-bold text-stone-700 dark:bg-stone-700 dark:text-stone-200">
													{t("roles.systemBadge")}
												</span>
											) : null}
										</p>
										{role.description ? (
											<p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
												{role.description}
											</p>
										) : null}
										<p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
											{t("roles.permissionsCount").replace(
												"{{count}}",
												String(role.permissions.length),
											)}{" "}
											·{" "}
											{role.domainScopeCount === 0 && role.linkScopeCount === 0
												? t("roles.unrestricted")
												: `${t("roles.scopeDomains")}: ${role.domainScopeCount}, ${t("roles.scopeLinks")}: ${role.linkScopeCount}`}{" "}
											·{" "}
											{t("roles.usersCount").replace(
												"{{count}}",
												String(role.userCount),
											)}
										</p>
									</div>
									<div className="flex gap-2">
										<Button
											disabled={role.isSystem}
											onClick={() => openEdit(role.id)}
											tone="secondary"
											type="button"
										>
											{t("roles.edit")}
										</Button>
										<Button
											disabled={role.isSystem || role.userCount > 0}
											onClick={() => deleteRole(role.id)}
											tone="danger"
											type="button"
										>
											{t("roles.delete")}
										</Button>
									</div>
								</div>
							</div>
						))
					) : (
						<p className="text-sm text-stone-600 dark:text-stone-300">
							{t("roles.empty")}
						</p>
					)}
				</div>
			</Card>

			{editor && catalog ? (
				<Card>
					<RoleEditor
						catalog={catalog}
						domains={domains}
						links={links}
						mode={editor.mode}
						onCancel={() => setEditor(null)}
						onSaved={async () => {
							setEditor(null);
							await refresh();
						}}
						role={editor.role}
						t={t}
					/>
				</Card>
			) : null}
		</div>
	);
}

function RoleEditor({
	catalog,
	domains,
	links,
	mode,
	onCancel,
	onSaved,
	role,
	t,
}: {
	catalog: PermissionCatalog;
	domains: AdminDomain[];
	links: LinkListItem[];
	mode: "create" | "edit";
	onCancel: () => void;
	onSaved: () => Promise<void>;
	role: AdminRoleDetail | null;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
}) {
	const [name, setName] = useState(role?.name ?? "");
	const [description, setDescription] = useState(role?.description ?? "");
	const [permissions, setPermissions] = useState<Set<Permission>>(
		new Set((role?.permissions ?? []) as Permission[]),
	);
	const [domainScope, setDomainScope] = useState<Set<string>>(
		new Set(role?.domainScopeIds ?? []),
	);
	const [linkScope, setLinkScope] = useState<Set<string>>(
		new Set(role?.linkScopeIds ?? []),
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
			if (mode === "edit" && role) {
				await unwrap(await api.admin.roles({ id: role.id }).patch(body));
			} else {
				await unwrap(await api.admin.roles.post(body));
			}
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
		<form className="grid gap-5" onSubmit={handleSubmit}>
			<h2 className="text-2xl font-black">
				{mode === "edit" ? t("roles.edit") : t("roles.create")}
			</h2>
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
				<p className="text-sm font-bold text-stone-800 dark:text-stone-200">
					{t("roles.permissions")}
				</p>
				<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
					{t("roles.permissionsHelp")}
				</p>
				<div className="mt-3 grid gap-4 md:grid-cols-2">
					{groupOrder.map((groupKey) => (
						<div
							key={groupKey}
							className="rounded-2xl border border-stone-950/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/5"
						>
							<p className="mb-2 text-xs font-black uppercase tracking-wide text-stone-700 dark:text-stone-300">
								{t(`roles.permissionGroup.${groupKey}`)}
							</p>
							<div className="grid gap-1">
								{catalog.groups[groupKey].map((perm) => (
									<label key={perm} className="flex items-center gap-2 text-sm">
										<input
											checked={permissions.has(perm as Permission)}
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
				<p className="text-sm font-bold text-stone-800 dark:text-stone-200">
					{t("roles.scopeDomains")}
				</p>
				<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
					{t("roles.scopeDomainsHelp")}
				</p>
				<div className="mt-3 grid gap-1 max-h-48 overflow-auto rounded-2xl border border-stone-950/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/5">
					{domains.length === 0 ? (
						<p className="text-xs text-stone-500">—</p>
					) : (
						domains.map((domain) => (
							<label
								key={domain.id}
								className="flex items-center gap-2 text-sm"
							>
								<input
									checked={domainScope.has(domain.id)}
									onChange={() =>
										setDomainScope((prev) => toggleSetItem(prev, domain.id))
									}
									type="checkbox"
								/>
								{domain.hostname}
								{domain.label ? (
									<span className="text-xs text-stone-500">
										({domain.label})
									</span>
								) : null}
							</label>
						))
					)}
				</div>
			</div>

			<div>
				<p className="text-sm font-bold text-stone-800 dark:text-stone-200">
					{t("roles.scopeLinks")}
				</p>
				<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
					{t("roles.scopeLinksHelp")}
				</p>
				<div className="mt-3 grid gap-1 max-h-48 overflow-auto rounded-2xl border border-stone-950/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/5">
					{links.length === 0 ? (
						<p className="text-xs text-stone-500">—</p>
					) : (
						links.map((link) => (
							<label key={link.id} className="flex items-center gap-2 text-sm">
								<input
									checked={linkScope.has(link.id)}
									onChange={() =>
										setLinkScope((prev) => toggleSetItem(prev, link.id))
									}
									type="checkbox"
								/>
								<span className="font-mono text-xs">
									{link.hostname === "__default__" ? "" : `${link.hostname}/`}
									{link.slug}
								</span>
								{link.title ? (
									<span className="text-xs text-stone-500">— {link.title}</span>
								) : null}
							</label>
						))
					)}
				</div>
			</div>

			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<div className="flex gap-2">
				<Button disabled={submitting} type="submit">
					{mode === "edit" ? t("forms.update") : t("forms.create")}
				</Button>
				<Button onClick={onCancel} tone="secondary" type="button">
					{t("forms.cancel")}
				</Button>
			</div>
		</form>
	);
}
