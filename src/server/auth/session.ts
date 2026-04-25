import { eq, inArray } from "drizzle-orm";

import { type Permission, parsePermissions } from "@/lib/permissions";

import { getLogger } from "../logging";
import { createDb } from "../db/client";
import {
	managedDomains,
	roleDomainScopes,
	roleLinkScopes,
	roles,
	user,
} from "../db/schema";
import { createAuth } from "./auth";
import { assertTrustedAdminWrite } from "./security";

const logger = getLogger("auth");

export type AuthUser = {
	id: string;
	email: string;
	name: string;
	locale: string;
	isActive: boolean;
};

export type AuthRole = {
	id: string;
	name: string;
	isSystem: boolean;
};

export type ScopeSet = ReadonlySet<string> | null;

export type AuthContext = {
	user: AuthUser;
	role: AuthRole;
	permissions: ReadonlySet<Permission>;
	domainScope: ScopeSet;
	linkScope: ScopeSet;
};

export async function getSession(request: Request) {
	return createAuth(request).api.getSession({
		headers: request.headers,
	});
}

export async function loadAuthContext(
	request: Request,
): Promise<AuthContext | null> {
	const session = await getSession(request);
	if (!session) {
		return null;
	}

	const db = createDb();
	const rows = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			locale: user.locale,
			isActive: user.isActive,
			roleId: user.roleId,
			roleName: roles.name,
			rolePermissions: roles.permissions,
			roleIsSystem: roles.isSystem,
		})
		.from(user)
		.innerJoin(roles, eq(user.roleId, roles.id))
		.where(eq(user.id, session.user.id))
		.limit(1);

	const row = rows[0];
	if (!row || row.isActive === false) {
		return null;
	}

	const [domainScopeRows, linkScopeRows] = await Promise.all([
		db
			.select({ domainId: roleDomainScopes.domainId })
			.from(roleDomainScopes)
			.where(eq(roleDomainScopes.roleId, row.roleId)),
		db
			.select({ linkId: roleLinkScopes.linkId })
			.from(roleLinkScopes)
			.where(eq(roleLinkScopes.roleId, row.roleId)),
	]);

	const domainScope: ScopeSet = domainScopeRows.length
		? new Set(domainScopeRows.map((r) => r.domainId))
		: null;
	const linkScope: ScopeSet = linkScopeRows.length
		? new Set(linkScopeRows.map((r) => r.linkId))
		: null;

	return {
		user: {
			id: row.id,
			email: row.email,
			name: row.name,
			locale: row.locale,
			isActive: row.isActive,
		},
		role: {
			id: row.roleId,
			name: row.roleName,
			isSystem: row.roleIsSystem,
		},
		permissions: parsePermissions(row.rolePermissions),
		domainScope,
		linkScope,
	};
}

export async function requireAuth(request: Request): Promise<AuthContext> {
	const ctx = await loadAuthContext(request);
	if (!ctx) {
		throw new Response("errors.unauthorized", { status: 401 });
	}
	return ctx;
}

export function requirePermission(
	ctx: AuthContext,
	permission: Permission | Permission[],
): void {
	const required = Array.isArray(permission) ? permission : [permission];
	for (const p of required) {
		if (!ctx.permissions.has(p)) {
			logger.warning("Permission denied", {
				userId: ctx.user.id,
				email: ctx.user.email,
				roleId: ctx.role.id,
				roleName: ctx.role.name,
				requiredPermission: p,
				userPermissions: [...ctx.permissions],
			});
			throw new Response(
				JSON.stringify({
					key: "errors.permissionDeniedDetail",
					roleName: ctx.role.name,
					permission: p,
				}),
				{
					status: 403,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
	}
}

export async function requirePermissionContext(
	request: Request,
	permission: Permission | Permission[],
): Promise<AuthContext> {
	const ctx = await requireAuth(request);
	requirePermission(ctx, permission);
	return ctx;
}

export async function requireSecurePermission(
	request: Request,
	permission: Permission | Permission[],
): Promise<AuthContext> {
	assertTrustedAdminWrite(request);
	return requirePermissionContext(request, permission);
}

type LinkLike = { id: string; hostname: string };
type DomainLike = { id: string };

export async function assertLinkInScope(
	ctx: AuthContext,
	link: LinkLike,
): Promise<void> {
	if (!ctx.domainScope && !ctx.linkScope) {
		return;
	}
	if (ctx.linkScope?.has(link.id)) {
		return;
	}
	if (ctx.domainScope && ctx.domainScope.size > 0) {
		const allowedHostnames = await resolveScopedHostnames(ctx.domainScope);
		if (allowedHostnames?.has(link.hostname)) {
			return;
		}
	}
	logger.info("Link scope denied", {
		userId: ctx.user.id,
		email: ctx.user.email,
		roleId: ctx.role.id,
		roleName: ctx.role.name,
		linkId: link.id,
		linkHostname: link.hostname,
		domainScope: ctx.domainScope ? [...ctx.domainScope] : null,
		linkScope: ctx.linkScope ? [...ctx.linkScope] : null,
	});
	throw new Response(
		JSON.stringify({
			key: "errors.linkScopeDenied",
			roleName: ctx.role.name,
		}),
		{
			status: 404,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export function assertDomainInScope(
	ctx: AuthContext,
	domain: DomainLike,
): void {
	if (!ctx.domainScope) {
		return;
	}
	if (ctx.domainScope.has(domain.id)) {
		return;
	}
	logger.info("Domain scope denied", {
		userId: ctx.user.id,
		email: ctx.user.email,
		roleId: ctx.role.id,
		roleName: ctx.role.name,
		domainId: domain.id,
		domainScope: [...ctx.domainScope],
	});
	throw new Response(
		JSON.stringify({
			key: "errors.domainScopeDenied",
			roleName: ctx.role.name,
		}),
		{
			status: 404,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export async function assertHostnameInScope(
	ctx: AuthContext,
	hostname: string,
): Promise<void> {
	if (!ctx.domainScope) {
		return;
	}
	const allowed = await resolveScopedHostnames(ctx.domainScope);
	if (allowed?.has(hostname)) {
		return;
	}
	logger.info("Hostname scope denied", {
		userId: ctx.user.id,
		email: ctx.user.email,
		roleId: ctx.role.id,
		roleName: ctx.role.name,
		requestedHostname: hostname,
		domainScope: [...ctx.domainScope],
		allowedHostnames: allowed ? [...allowed] : null,
	});
	throw new Response(
		JSON.stringify({
			key: "errors.scopeForbiddenDetail",
			roleName: ctx.role.name,
		}),
		{
			status: 403,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export async function resolveScopedHostnames(
	domainScope: ScopeSet,
): Promise<Set<string> | null> {
	if (!domainScope || domainScope.size === 0) {
		return null;
	}
	const db = createDb();
	const rows = await db
		.select({ hostname: managedDomains.hostname })
		.from(managedDomains)
		.where(inArray(managedDomains.id, [...domainScope]));
	return new Set(rows.map((row) => row.hostname));
}

export type LinkScopeQuery = {
	hostnames: ReadonlySet<string> | null;
	linkIds: ReadonlySet<string> | null;
} | null;

export async function buildLinkScopeForCtx(
	ctx: AuthContext,
): Promise<LinkScopeQuery> {
	if (!ctx.domainScope && !ctx.linkScope) {
		return null;
	}
	const hostnames = ctx.domainScope
		? ((await resolveScopedHostnames(ctx.domainScope)) ?? new Set<string>())
		: null;
	return {
		hostnames,
		linkIds: ctx.linkScope,
	};
}

export function buildDomainScopeForCtx(ctx: AuthContext): ScopeSet {
	return ctx.domainScope;
}
