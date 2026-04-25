import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, FieldLabel, Input, Notice } from "@/components/ui";
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
		useRequirePermission("roles.manage");
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
				<Card className="rounded-xl border-foreground/10 bg-card/60 p-6 shadow-[0_24px_80px_rgba(29,27,22,0.10)] backdrop-blur dark:bg-foreground/70 dark:shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
					{t("loading.app")}
				</Card>
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
			<Card className="rounded-xl border-foreground/10 bg-card/60 p-6 shadow-[0_24px_80px_rgba(29,27,22,0.10)] backdrop-blur dark:bg-foreground/70 dark:shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
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
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [permissions, setPermissions] = useState<Set<Permission>>(
		new Set(["sessions.manage" as Permission]),
	);
	const [domainScope, setDomainScope] = useState<Set<string>>(new Set());
	const [linkScope, setLinkScope] = useState<Set<string>>(new Set());
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
			await unwrap(await api.admin.roles.post(body));
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
				<textarea
					className="min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
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
							className="rounded-md border border-foreground/10 bg-white/50 p-3 "
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
				<div className="mt-3 grid max-h-48 gap-1 overflow-auto rounded-md border border-foreground/10 bg-white/50 p-3 ">
					{domains.length === 0 ? (
						<p className="text-xs text-muted-foreground/80">—</p>
					) : (
						domains.map((domain) => (
							<label
								className="flex items-center gap-2 text-sm"
								key={domain.id}
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
									<span className="text-xs text-muted-foreground/80">
										({domain.label})
									</span>
								) : null}
							</label>
						))
					)}
				</div>
			</div>

			<div>
				<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
					{t("roles.scopeLinks")}
				</p>
				<p className="mt-1 text-xs text-muted-foreground/80">
					{t("roles.scopeLinksHelp")}
				</p>
				<div className="mt-3 grid max-h-48 gap-1 overflow-auto rounded-md border border-foreground/10 bg-white/50 p-3 ">
					{links.length === 0 ? (
						<p className="text-xs text-muted-foreground/80">—</p>
					) : (
						links.map((link) => (
							<label className="flex items-center gap-2 text-sm" key={link.id}>
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
									<span className="text-xs text-muted-foreground/80">
										— {link.title}
									</span>
								) : null}
							</label>
						))
					)}
				</div>
			</div>

			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<div className="flex gap-2">
				<Button disabled={submitting} type="submit">
					{t("forms.create")}
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
