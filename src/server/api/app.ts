import { env, waitUntil } from "cloudflare:workers";
import { serverTiming } from "@elysiajs/server-timing";
import { swagger } from "@elysiajs/swagger";
import { and, eq, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { createTranslator, interpolate, normalizeLocale } from "@/lib/i18n";
import {
	isPermission,
	PERMISSION_GROUPS,
	PERMISSIONS,
	type Permission,
} from "@/lib/permissions";
import {
	isRedirectStatusCode,
	type RedirectStatusCode,
} from "@/lib/redirect-status";
import pkg from "../../../package.json";
import { createAgentLoginResponse } from "../auth/agent-login";
import { createAuth } from "../auth/auth";
import {
	createBootstrapContext,
	createInviteContext,
} from "../auth/onboarding";
import { assertTrustedAdminWrite } from "../auth/security";
import {
	type AuthContext,
	assertDomainInScope,
	assertHostnameInScope,
	assertLinkInScope,
	buildDomainScopeForCtx,
	buildLinkScopeForCtx,
	getSession,
	requireAuth,
	requirePermissionContext,
	requireSecurePermission,
} from "../auth/session";
import { createDb } from "../db/client";
import { DEFAULT_HOSTNAME, SYSTEM_ROLE_ADMIN, user } from "../db/schema";
import { getLogger, serializeError } from "../logging";
import {
	appendDomainToRoleScopeIfScoped,
	appendLinkToRoleScopeIfScoped,
	buildAnalyticsTarget,
	buildInviteUrl,
	buildRedirectTarget,
	createInvite,
	deleteDomain,
	deleteLink,
	extractUtmParams,
	getBootstrapState,
	getDashboardData,
	getDomainById,
	getInviteByToken,
	getLinkById,
	getLinkStats,
	getManagedDomainByHostname,
	listDomains,
	listShortLinks,
	normalizeHostname,
	recordRedirectEvent,
	resolveExactRedirect,
	resolveRedirect,
	saveDomain,
	saveLink,
	suggestSlugFromUrl,
	updateInvite,
} from "../services/links";
import {
	createRole,
	deleteRole,
	getRoleById,
	listAssignableRoles,
	listRoles,
	updateRole,
} from "../services/roles";
import {
	assignUserRole,
	deleteInvite,
	deleteUser,
	getInviteById,
	getUserById,
	listAllInvites,
	listUsers,
	updateUser,
} from "../services/users";

type AiBinding = {
	run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

const runtimeEnv = env as typeof env & {
	AGENT_BROWSER_AUTH_ENABLED?: string;
	AGENT_BROWSER_AUTH_SECRET?: string;
	AI?: AiBinding;
	BETTER_AUTH_SECRET?: string;
};

const redirectStatusCodeSchema = t.Union([
	t.Literal(301),
	t.Literal(302),
	t.Literal(303),
	t.Literal(307),
	t.Literal(308),
]);

const linkBody = t.Object({
	hostname: t.Optional(t.String()),
	slug: t.Optional(t.String()),
	targetUrl: t.String({ minLength: 1 }),
	title: t.Optional(t.String()),
	notes: t.Optional(t.String()),
	statusCode: t.Optional(redirectStatusCodeSchema),
	preserveQueryParams: t.Optional(t.Boolean()),
	isActive: t.Optional(t.Boolean()),
});

const domainBody = t.Object({
	hostname: t.String({ minLength: 1 }),
	label: t.Optional(t.String()),
	isPrimary: t.Optional(t.Boolean()),
	isActive: t.Optional(t.Boolean()),
	rootBehavior: t.Optional(
		t.Union([t.Literal("landing"), t.Literal("redirect")]),
	),
	rootRedirectStatusCode: t.Optional(redirectStatusCodeSchema),
	rootRedirectTargetUrl: t.Optional(t.String()),
	unknownSlugBehavior: t.Optional(
		t.Union([t.Literal("not_found"), t.Literal("redirect")]),
	),
	unknownSlugRedirectStatusCode: t.Optional(redirectStatusCodeSchema),
	unknownSlugRedirectTargetUrl: t.Optional(t.String()),
});

const apiKeyListQuery = t.Object({
	limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
	offset: t.Optional(t.Number({ minimum: 0 })),
	sortBy: t.Optional(t.Union([t.Literal("createdAt"), t.Literal("name")])),
	sortDirection: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
});

const apiKeyCreateBody = t.Object({
	expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 365 })),
	name: t.String({ minLength: 1 }),
});

const apiKeyUpdateBody = t.Object({
	enabled: t.Optional(t.Boolean()),
	expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 365 })),
	name: t.Optional(t.String({ minLength: 1 })),
});

const roleBody = t.Object({
	name: t.String({ minLength: 1, maxLength: 64 }),
	description: t.Optional(t.String()),
	permissions: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
	domainScopeIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
	linkScopeIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
});

function coercePermissionList(values: string[]): Permission[] {
	return values.filter(isPermission);
}

function getClientIp(request: Request) {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		null
	);
}

async function hashIp(value: string | null) {
	if (!value || !runtimeEnv.BETTER_AUTH_SECRET) {
		return null;
	}

	const material = `${runtimeEnv.BETTER_AUTH_SECRET}:${value}`;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(material),
	);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function localeFromRequest(request: Request) {
	return normalizeLocale(
		request.headers.get("cookie")?.match(/shorty_locale=([^;]+)/)?.[1] ??
			request.headers.get("accept-language"),
	);
}

const apiLog = getLogger(["api"]);

async function jsonError(error: unknown, request: Request) {
	const tMessage = createTranslator(localeFromRequest(request));
	const path = new URL(request.url).pathname;

	if (error instanceof Response) {
		const body = await error.text();
		let parsed: {
			key?: string;
			roleName?: string;
			permission?: string;
		} | null = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* plain text body */
		}

		if (parsed?.key) {
			let message = tMessage(parsed.key);
			if (parsed.roleName) {
				const vars: Record<string, string> = {
					roleName: parsed.roleName,
				};
				if (parsed.permission) {
					vars.permission = tMessage(`permissions.${parsed.permission}`);
				}
				message = interpolate(message, vars);
			}
			apiLog.debug("api error response", {
				path,
				method: request.method,
				status: error.status,
				key: parsed.key,
				roleName: parsed.roleName,
				permission: parsed.permission,
			});
			return Response.json(
				{ code: "AUTH_ERROR", message },
				{ status: error.status },
			);
		}

		apiLog.debug("api error response", {
			path,
			method: request.method,
			status: error.status,
			message: body,
		});
		return Response.json(
			{
				code: "AUTH_ERROR",
				message: tMessage(body),
			},
			{ status: error.status },
		);
	}

	const key = error instanceof Error ? error.message : "errors.unknown";
	if (key === "errors.unknown" || !key.startsWith("errors.")) {
		apiLog.error("api handler threw", {
			path,
			method: request.method,
			error: serializeError(error),
		});
	} else {
		apiLog.debug("api domain error", {
			path,
			method: request.method,
			code: key,
		});
	}
	return Response.json(
		{
			code: key,
			message: tMessage(key),
		},
		{ status: 400 },
	);
}

async function requireAuthOrError(request: Request) {
	try {
		return await requireAuth(request);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

async function requirePermissionOrError(
	request: Request,
	permission: Permission | Permission[],
) {
	try {
		return await requirePermissionContext(request, permission);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

async function requireSecurePermissionOrError(
	request: Request,
	permission: Permission | Permission[],
) {
	try {
		return await requireSecurePermission(request, permission);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

async function requireSignedOutInviteRequest(request: Request) {
	if (await getSession(request)) {
		throw new Response("errors.inviteRequiresSignOut", { status: 403 });
	}
}

async function suggestSlugWithAi(targetUrl: string) {
	const fallback = suggestSlugFromUrl(targetUrl);

	if (!runtimeEnv.AI) {
		return fallback;
	}

	const response = await runtimeEnv.AI.run(
		"@cf/meta/llama-3.1-8b-instruct-fast",
		{
			messages: [
				{
					role: "system",
					content:
						"Return exactly one lowercase URL slug using only letters, numbers, hyphens, and underscores. Do not include commentary.",
				},
				{
					role: "user",
					content: `Suggest a concise memorable slug for ${targetUrl}`,
				},
			],
			max_tokens: 24,
		},
	);

	const raw =
		typeof response === "string"
			? response
			: typeof response === "object" &&
					response !== null &&
					"response" in response &&
					typeof response.response === "string"
				? response.response
				: fallback;

	return (
		raw
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-_]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "") || fallback
	);
}

function expiresInSeconds(days?: number) {
	return days ? days * 24 * 60 * 60 : null;
}

function managedDomainRedirectResponse(
	request: Request,
	input: {
		statusCode: number | null;
		targetUrl: string | null;
	},
) {
	if (!input.statusCode || !input.targetUrl) {
		return null;
	}

	return Response.redirect(
		buildRedirectTarget(input.targetUrl, request.url, false),
		input.statusCode,
	);
}

async function signOutResponse(request: Request) {
	const url = new URL("/api/auth/sign-out", request.url);

	return createAuth(request).handler(
		new Request(url, {
			headers: request.headers,
			method: "POST",
		}),
	);
}

async function fetchLinkInScope(
	db: ReturnType<typeof createDb>,
	ctx: AuthContext,
	id: string,
) {
	const link = await getLinkById(db, id);
	if (!link) {
		throw new Response("errors.linkMissing", { status: 404 });
	}
	await assertLinkInScope(ctx, link);
	return link;
}

async function fetchDomainInScope(
	db: ReturnType<typeof createDb>,
	ctx: AuthContext,
	id: string,
) {
	const domain = await getDomainById(db, id);
	if (!domain) {
		throw new Response("errors.domainMissing", { status: 404 });
	}
	assertDomainInScope(ctx, domain);
	return domain;
}

function authSessionShape(ctx: AuthContext) {
	return {
		user: {
			id: ctx.user.id,
			email: ctx.user.email,
			name: ctx.user.name,
			locale: ctx.user.locale,
			isActive: ctx.user.isActive,
			roleId: ctx.role.id,
			roleName: ctx.role.name,
		},
		role: ctx.role,
		permissions: [...ctx.permissions],
		domainScope: ctx.domainScope ? [...ctx.domainScope] : null,
		linkScope: ctx.linkScope ? [...ctx.linkScope] : null,
	};
}

export const app = new Elysia({
	aot: false,
	adapter: CloudflareAdapter,
	normalize: "typebox",
})
	.derive(({ request }) => ({
		db: createDb(),
		locale: localeFromRequest(request),
	}))
	.use(
		serverTiming({
			enabled: true,
			allow: ({ request }) =>
				new URL(request.url).pathname.startsWith("/api/admin"),
			trace: {
				request: true,
				beforeHandle: true,
				handle: true,
				afterHandle: true,
				total: true,
			},
		}),
	)
	.onError(({ error, request }) => jsonError(error, request))
	.use(
		process.env.NODE_ENV !== "production"
			? swagger({
					path: "/api/docs",
					documentation: {
						info: {
							title: "Shorty Link API",
							version: pkg.version,
						},
					},
				})
			: new Elysia(),
	)
	.get(
		"/api/health",
		() => ({
			ok: true,
			service: "shorty-link",
		}),
		{
			detail: { tags: ["Health"], summary: "Health check" },
		},
	)
	.get(
		"/api/dev/agent-login",
		({ db, request }) =>
			createAgentLoginResponse({ db, env: runtimeEnv, request }),
		{
			detail: {
				tags: ["Dev"],
				summary: "Agent browser login",
				description:
					"Dev-only endpoint returning HTML for agent browser authentication.",
			},
			query: t.Object({
				email: t.Optional(t.String({ format: "email" })),
				locale: t.Optional(t.String()),
				name: t.Optional(t.String()),
				redirect: t.Optional(t.String()),
				secret: t.Optional(t.String()),
			}),
		},
	)
	.group("/api/admin", (admin) =>
		admin
			.get("/bootstrap", ({ db }) => getBootstrapState(db), {
				detail: { tags: ["Onboarding"], summary: "Check bootstrap state" },
			})
			.post(
				"/onboarding/bootstrap",
				async ({ body, db, request }) => {
					assertTrustedAdminWrite(request);
					return {
						context: await createBootstrapContext(db, body, request),
					};
				},
				{
					detail: {
						tags: ["Onboarding"],
						summary: "Complete onboarding bootstrap",
					},
					body: t.Object({
						email: t.String({ format: "email" }),
						locale: t.Optional(t.String()),
						name: t.String({ minLength: 2 }),
					}),
				},
			)
			.get(
				"/dashboard",
				async ({ db, request }) => {
					const ctx = await requireAuthOrError(request);
					const linkScope = await buildLinkScopeForCtx(ctx);
					const domainScope = buildDomainScopeForCtx(ctx);
					const dashboard = await getDashboardData(db, {
						linkScope,
						domainScope,
					});
					const origin = new URL(request.url).origin;

					return {
						...dashboard,
						invites: dashboard.invites.map((invite) => ({
							...invite,
							inviteUrl: buildInviteUrl(origin, invite.token),
						})),
						session: authSessionShape(ctx),
					};
				},
				{
					detail: { tags: ["Dashboard"], summary: "Get dashboard data" },
				},
			)
			.get(
				"/profile",
				async ({ request }) => {
					const ctx = await requireAuthOrError(request);
					return authSessionShape(ctx).user;
				},
				{
					detail: { tags: ["Profile"], summary: "Get current user profile" },
				},
			)
			.patch(
				"/profile",
				async ({ body, db, request }) => {
					assertTrustedAdminWrite(request);
					const ctx = await requireAuthOrError(request);
					const email = body.email.trim().toLowerCase();
					const existing = await db
						.select({ id: user.id })
						.from(user)
						.where(and(eq(user.email, email), ne(user.id, ctx.user.id)))
						.limit(1);

					if (existing[0]) {
						throw new Error("errors.profileEmailTaken");
					}

					await db
						.update(user)
						.set({
							email,
							locale: normalizeLocale(body.locale),
							name: body.name.trim(),
							updatedAt: new Date(),
						})
						.where(eq(user.id, ctx.user.id));

					return { ok: true };
				},
				{
					detail: { tags: ["Profile"], summary: "Update current user profile" },
					body: t.Object({
						email: t.String({ format: "email" }),
						locale: t.Optional(t.String()),
						name: t.String({ minLength: 2 }),
					}),
				},
			)
			.get(
				"/auth-context",
				async ({ request }) => {
					const ctx = await requireAuthOrError(request);
					return {
						role: ctx.role,
						permissions: [...ctx.permissions],
					};
				},
				{
					detail: { tags: ["Auth"], summary: "Get current auth context" },
				},
			)
			.get(
				"/links",
				async ({ db, query, request }) => {
					const ctx = await requirePermissionOrError(request, "links.read");
					const scope = await buildLinkScopeForCtx(ctx);
					return listShortLinks(
						db,
						{
							active: query.active,
							hostname: query.hostname,
							page: query.page,
							pageSize: query.pageSize,
							search: query.search,
							statusCode:
								typeof query.statusCode === "number" &&
								isRedirectStatusCode(query.statusCode)
									? (query.statusCode as RedirectStatusCode)
									: "all",
						},
						scope,
					);
				},
				{
					detail: { tags: ["Links"], summary: "List links" },
					query: t.Object({
						active: t.Optional(
							t.Union([
								t.Literal("active"),
								t.Literal("inactive"),
								t.Literal("all"),
							]),
						),
						hostname: t.Optional(t.String()),
						page: t.Optional(t.Number({ minimum: 1 })),
						pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
						search: t.Optional(t.String()),
						statusCode: t.Optional(t.Number({ minimum: 301, maximum: 308 })),
					}),
				},
			)
			.post(
				"/links",
				async ({ body, db, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"links.write",
					);
					const targetHost = normalizeHostname(body.hostname);
					if (ctx.domainScope) {
						await assertHostnameInScope(ctx, targetHost);
					} else if (ctx.linkScope) {
						// Link-only scope (no domain scope) cannot create new links.
						throw new Response("errors.linkScopeRequiresDomain", {
							status: 403,
						});
					}
					const id = await saveLink(db, {
						...body,
						createdBy: ctx.user.id,
					});
					await appendLinkToRoleScopeIfScoped(db, ctx.role.id, id);
					return { id };
				},
				{
					detail: { tags: ["Links"], summary: "Create link" },
					body: linkBody,
				},
			)
			.get(
				"/links/:id",
				async ({ db, params, request }) => {
					const ctx = await requirePermissionOrError(request, "links.read");
					return fetchLinkInScope(db, ctx, params.id);
				},
				{
					detail: { tags: ["Links"], summary: "Get link by ID" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/links/:id/stats",
				async ({ db, params, query, request }) => {
					const ctx = await requirePermissionOrError(request, "links.read");
					const link = await fetchLinkInScope(db, ctx, params.id);
					const hasAnalytics = ctx.permissions.has("analytics.read");
					const stats = hasAnalytics
						? await getLinkStats(db, params.id, {
								days: query.days,
							})
						: null;
					return { link, stats };
				},
				{
					detail: { tags: ["Links"], summary: "Get link statistics" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
					query: t.Object({
						days: t.Optional(t.Number({ minimum: 1, maximum: 180 })),
					}),
				},
			)
			.patch(
				"/links/:id",
				async ({ body, db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"links.write",
					);
					await fetchLinkInScope(db, ctx, params.id);
					const targetHost = normalizeHostname(body.hostname);
					if (ctx.domainScope) {
						await assertHostnameInScope(ctx, targetHost);
					}
					return {
						id: await saveLink(db, {
							...body,
							id: params.id,
							createdBy: ctx.user.id,
						}),
					};
				},
				{
					detail: { tags: ["Links"], summary: "Update link" },
					body: linkBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/links/:id",
				async ({ db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"links.delete",
					);
					await fetchLinkInScope(db, ctx, params.id);
					await deleteLink(db, params.id);
					return { ok: true };
				},
				{
					detail: { tags: ["Links"], summary: "Delete link" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/domains",
				async ({ db, request }) => {
					const ctx = await requirePermissionOrError(request, "domains.read");
					return listDomains(db, buildDomainScopeForCtx(ctx));
				},
				{
					detail: { tags: ["Domains"], summary: "List domains" },
				},
			)
			.post(
				"/domains",
				async ({ body, db, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"domains.write",
					);
					const id = await saveDomain(db, {
						...body,
						createdBy: ctx.user.id,
					});
					await appendDomainToRoleScopeIfScoped(db, ctx.role.id, id);
					return { id };
				},
				{
					detail: { tags: ["Domains"], summary: "Create domain" },
					body: domainBody,
				},
			)
			.get(
				"/domains/:id",
				async ({ db, params, request }) => {
					const ctx = await requirePermissionOrError(request, "domains.read");
					return fetchDomainInScope(db, ctx, params.id);
				},
				{
					detail: { tags: ["Domains"], summary: "Get domain by ID" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/domains/:id",
				async ({ body, db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"domains.write",
					);
					await fetchDomainInScope(db, ctx, params.id);
					return {
						id: await saveDomain(db, {
							...body,
							id: params.id,
							createdBy: ctx.user.id,
						}),
					};
				},
				{
					detail: { tags: ["Domains"], summary: "Update domain" },
					body: domainBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/domains/:id",
				async ({ db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"domains.delete",
					);
					await fetchDomainInScope(db, ctx, params.id);
					await deleteDomain(db, params.id);
					return { ok: true };
				},
				{
					detail: { tags: ["Domains"], summary: "Delete domain" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.post(
				"/invites",
				async ({ body, db, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"invites.create",
					);
					const invite = await createInvite(db, {
						email: body.email,
						expiresInDays: body.expiresInDays,
						invitedBy: ctx.user.id,
						roleId: body.roleId ?? SYSTEM_ROLE_ADMIN,
					});

					return {
						...invite,
						inviteUrl: buildInviteUrl(
							new URL(request.url).origin,
							invite.token,
						),
					};
				},
				{
					detail: { tags: ["Invites"], summary: "Create invite" },
					body: t.Object({
						email: t.String({ format: "email" }),
						expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
						roleId: t.Optional(t.String({ minLength: 1 })),
					}),
				},
			)
			.get(
				"/invites/:id",
				async ({ db, params, request }) => {
					await requirePermissionOrError(request, "invites.read");
					const invite = await getInviteById(db, params.id);
					const origin = new URL(request.url).origin;
					return {
						...invite,
						inviteUrl:
							invite.status === "pending"
								? buildInviteUrl(origin, invite.token)
								: null,
					};
				},
				{
					detail: { tags: ["Invites"], summary: "Get invite by ID" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/invites/:id",
				async ({ body, db, params, request }) => {
					await requireSecurePermissionOrError(request, "invites.update");
					await updateInvite(db, params.id, {
						email: body.email,
						roleId: body.roleId,
						expiresInDays: body.expiresInDays,
					});
					return { ok: true };
				},
				{
					detail: { tags: ["Invites"], summary: "Update invite" },
					body: t.Object({
						email: t.Optional(t.String({ format: "email" })),
						roleId: t.Optional(t.String({ minLength: 1 })),
						expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
					}),
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/invites/:id",
				async ({ body, db, params, request }) => {
					await requireSecurePermissionOrError(request, "invites.update");
					await updateInvite(db, params.id, {
						email: body.email,
						roleId: body.roleId,
						expiresInDays: body.expiresInDays,
					});
					return { ok: true };
				},
				{
					body: t.Object({
						email: t.Optional(t.String({ format: "email" })),
						roleId: t.Optional(t.String({ minLength: 1 })),
						expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
					}),
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/users",
				async ({ db, query, request }) => {
					await requirePermissionOrError(request, "users.read");
					return listUsers(db, {
						active: query.active,
						page: query.page,
						pageSize: query.pageSize,
						roleId: query.roleId,
						search: query.search,
					});
				},
				{
					detail: { tags: ["Users"], summary: "List users" },
					query: t.Object({
						active: t.Optional(
							t.Union([
								t.Literal("active"),
								t.Literal("inactive"),
								t.Literal("all"),
							]),
						),
						page: t.Optional(t.Number({ minimum: 1 })),
						pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
						roleId: t.Optional(t.String({ minLength: 1 })),
						search: t.Optional(t.String()),
					}),
				},
			)
			.get(
				"/users/:id",
				async ({ db, params, request }) => {
					await requirePermissionOrError(request, "users.read");
					return getUserById(db, params.id);
				},
				{
					detail: { tags: ["Users"], summary: "Get user by ID" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/users/:id",
				async ({ body, db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"users.write",
					);
					if (params.id === ctx.user.id && body.isActive === false) {
						throw new Error("errors.cannotSelfDisable");
					}
					await updateUser(db, params.id, {
						name: body.name,
						email: body.email,
						locale: body.locale,
						isActive: body.isActive,
					});
					return { ok: true };
				},
				{
					detail: { tags: ["Users"], summary: "Update user" },
					body: t.Object({
						isActive: t.Optional(t.Boolean()),
						name: t.Optional(t.String({ minLength: 2 })),
						email: t.Optional(t.String({ format: "email" })),
						locale: t.Optional(t.String()),
					}),
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/users/:id/role",
				async ({ body, db, params, request }) => {
					await requireSecurePermissionOrError(request, "users.write");
					await assignUserRole(db, params.id, body.roleId);
					return { ok: true };
				},
				{
					detail: { tags: ["Users"], summary: "Assign user role" },
					body: t.Object({
						roleId: t.String({ minLength: 1 }),
					}),
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/users/:id",
				async ({ db, params, request }) => {
					const ctx = await requireSecurePermissionOrError(
						request,
						"users.delete",
					);
					if (params.id === ctx.user.id) {
						throw new Error("errors.cannotSelfDelete");
					}
					await deleteUser(db, params.id);
					return { ok: true };
				},
				{
					detail: { tags: ["Users"], summary: "Delete user" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/sessions",
				async ({ request }) => {
					await requirePermissionOrError(request, "sessions.manage");
					return createAuth(request).api.listSessions({
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["Sessions"], summary: "List active sessions" },
				},
			)
			.post(
				"/sessions/revoke",
				async ({ body, request }) => {
					await requireSecurePermissionOrError(request, "sessions.manage");
					return createAuth(request).api.revokeSession({
						body,
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["Sessions"], summary: "Revoke a session" },
					body: t.Object({
						token: t.String({ minLength: 1 }),
					}),
				},
			)
			.post(
				"/sessions/revoke-other",
				async ({ request }) => {
					await requireSecurePermissionOrError(request, "sessions.manage");
					return createAuth(request).api.revokeOtherSessions({
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["Sessions"], summary: "Revoke all other sessions" },
				},
			)
			.delete(
				"/sessions/current",
				async ({ request }) => {
					assertTrustedAdminWrite(request);
					await requireAuthOrError(request);
					return signOutResponse(request);
				},
				{
					detail: { tags: ["Sessions"], summary: "Sign out current session" },
				},
			)
			.get(
				"/api-keys",
				async ({ query, request }) => {
					await requirePermissionOrError(request, "apikeys.manage");
					return createAuth(request).api.listApiKeys({
						headers: request.headers,
						query: {
							limit: query.limit ?? 100,
							offset: query.offset,
							sortBy: query.sortBy ?? "createdAt",
							sortDirection: query.sortDirection ?? "desc",
						},
					});
				},
				{
					detail: { tags: ["API Keys"], summary: "List API keys" },
					query: apiKeyListQuery,
				},
			)
			.post(
				"/api-keys",
				async ({ body, request }) => {
					await requireSecurePermissionOrError(request, "apikeys.manage");
					return createAuth(request).api.createApiKey({
						body: {
							expiresIn: expiresInSeconds(body.expiresInDays),
							name: body.name,
						},
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["API Keys"], summary: "Create API key" },
					body: apiKeyCreateBody,
				},
			)
			.patch(
				"/api-keys/:id",
				async ({ body, params, request }) => {
					await requireSecurePermissionOrError(request, "apikeys.manage");
					return createAuth(request).api.updateApiKey({
						body: {
							enabled: body.enabled,
							expiresIn:
								body.expiresInDays === undefined
									? undefined
									: expiresInSeconds(body.expiresInDays),
							keyId: params.id,
							name: body.name,
						},
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["API Keys"], summary: "Update API key" },
					body: apiKeyUpdateBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/api-keys/:id",
				async ({ params, request }) => {
					await requireSecurePermissionOrError(request, "apikeys.manage");
					return createAuth(request).api.deleteApiKey({
						body: { keyId: params.id },
						headers: request.headers,
					});
				},
				{
					detail: { tags: ["API Keys"], summary: "Delete API key" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/invites",
				async ({ db, query, request }) => {
					await requirePermissionOrError(request, "invites.read");
					const result = await listAllInvites(db, {
						page: query.page,
						pageSize: query.pageSize,
						roleId: query.roleId,
						search: query.search,
						status: query.status,
					});
					const origin = new URL(request.url).origin;
					return {
						...result,
						items: result.items.map((invite) => ({
							...invite,
							inviteUrl:
								invite.status === "pending"
									? buildInviteUrl(origin, invite.token)
									: null,
						})),
					};
				},
				{
					detail: { tags: ["Invites"], summary: "List invites" },
					query: t.Object({
						page: t.Optional(t.Number({ minimum: 1 })),
						pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
						roleId: t.Optional(t.String({ minLength: 1 })),
						search: t.Optional(t.String()),
						status: t.Optional(
							t.Union([
								t.Literal("pending"),
								t.Literal("expired"),
								t.Literal("accepted"),
								t.Literal("all"),
							]),
						),
					}),
				},
			)
			.delete(
				"/invites",
				async ({ body, db, request }) => {
					await requireSecurePermissionOrError(request, "invites.delete");
					await deleteInvite(db, body.id);
					return { ok: true };
				},
				{
					detail: { tags: ["Invites"], summary: "Delete invite" },
					body: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/suggest-slug",
				async ({ query, request }) => {
					await requirePermissionOrError(request, "links.write");
					return { slug: await suggestSlugWithAi(query.targetUrl) };
				},
				{
					detail: { tags: ["Links"], summary: "Suggest a slug from URL" },
					query: t.Object({
						targetUrl: t.String({ minLength: 1 }),
					}),
				},
			)
			.get(
				"/permissions",
				async ({ request }) => {
					await requirePermissionOrError(request, "roles.read");
					return {
						permissions: PERMISSIONS,
						groups: PERMISSION_GROUPS,
					};
				},
				{
					detail: {
						tags: ["Roles"],
						summary: "List all permissions and groups",
					},
				},
			)
			.get(
				"/roles/assignable",
				async ({ db, request }) => {
					await requirePermissionOrError(request, "users.read");
					return listAssignableRoles(db);
				},
				{
					detail: { tags: ["Roles"], summary: "List assignable roles" },
				},
			)
			.get(
				"/roles",
				async ({ db, query, request }) => {
					await requirePermissionOrError(request, "roles.read");
					return listRoles(db, {
						page: query.page,
						pageSize: query.pageSize,
						search: query.search,
					});
				},
				{
					detail: { tags: ["Roles"], summary: "List roles" },
					query: t.Object({
						page: t.Optional(t.Number({ minimum: 1 })),
						pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
						search: t.Optional(t.String()),
					}),
				},
			)
			.get(
				"/roles/:id",
				async ({ db, params, request }) => {
					await requirePermissionOrError(request, "roles.read");
					const role = await getRoleById(db, params.id);
					if (!role) {
						throw new Error("errors.roleMissing");
					}
					return role;
				},
				{
					detail: { tags: ["Roles"], summary: "Get role by ID" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.post(
				"/roles",
				async ({ body, db, request }) => {
					await requireSecurePermissionOrError(request, "roles.create");
					const id = await createRole(db, {
						...body,
						permissions: coercePermissionList(body.permissions),
					});
					return { id };
				},
				{
					detail: { tags: ["Roles"], summary: "Create role" },
					body: roleBody,
				},
			)
			.patch(
				"/roles/:id",
				async ({ body, db, params, request }) => {
					await requireSecurePermissionOrError(request, "roles.update");
					await updateRole(db, params.id, {
						...body,
						permissions: coercePermissionList(body.permissions),
					});
					return { ok: true };
				},
				{
					detail: { tags: ["Roles"], summary: "Update role" },
					body: roleBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/roles/:id",
				async ({ db, params, request }) => {
					await requireSecurePermissionOrError(request, "roles.delete");
					await deleteRole(db, params.id);
					return { ok: true };
				},
				{
					detail: { tags: ["Roles"], summary: "Delete role" },
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			),
	)
	.get(
		"/api/invites/:token",
		async ({ db, params, request }) => {
			await requireSignedOutInviteRequest(request);
			const invite = await getInviteByToken(db, params.token);
			if (!invite) {
				throw new Error("errors.inviteMissing");
			}
			return {
				email: invite.email,
				expiresAt: invite.expiresAt,
				token: invite.token,
			};
		},
		{
			detail: { tags: ["Invites"], summary: "Lookup invite by token" },
			params: t.Object({ token: t.String({ minLength: 16 }) }),
		},
	)
	.post(
		"/api/onboarding/invite",
		async ({ body, db, request }) => {
			assertTrustedAdminWrite(request);
			await requireSignedOutInviteRequest(request);
			return {
				context: await createInviteContext(db, body, request),
			};
		},
		{
			detail: { tags: ["Onboarding"], summary: "Accept onboarding invite" },
			body: t.Object({
				locale: t.Optional(t.String()),
				name: t.String({ minLength: 2 }),
				token: t.String({ minLength: 16 }),
			}),
		},
	)
	.get(
		"/*",
		async ({ db, request }) => {
			const url = new URL(request.url);
			const tMessage = createTranslator(localeFromRequest(request));
			const slug = url.pathname.replace(/^\/+/, "");
			const hostname = url.hostname.toLowerCase();
			const managedDomain =
				hostname === DEFAULT_HOSTNAME
					? null
					: await getManagedDomainByHostname(db, hostname);

			if (!slug) {
				const rootRedirect = managedDomainRedirectResponse(request, {
					statusCode: managedDomain?.rootRedirectStatusCode ?? null,
					targetUrl: managedDomain?.rootRedirectTargetUrl ?? null,
				});
				if (managedDomain?.rootBehavior === "redirect" && rootRedirect) {
					return rootRedirect;
				}
				return new Response(tMessage("redirect.online"), { status: 200 });
			}

			const link = managedDomain
				? await resolveExactRedirect(db, {
						hostname,
						slug,
					})
				: await resolveRedirect(db, {
						hostname,
						slug,
					});

			if (!link) {
				const unknownSlugRedirect = managedDomainRedirectResponse(request, {
					statusCode: managedDomain?.unknownSlugRedirectStatusCode ?? null,
					targetUrl: managedDomain?.unknownSlugRedirectTargetUrl ?? null,
				});
				if (
					managedDomain?.unknownSlugBehavior === "redirect" &&
					unknownSlugRedirect
				) {
					return unknownSlugRedirect;
				}
				return new Response(tMessage("redirect.notFound"), { status: 404 });
			}

			const redirectTarget = buildRedirectTarget(
				link.targetUrl,
				request.url,
				link.preserveQueryParams,
			);
			const analyticsTarget = buildAnalyticsTarget(
				link.targetUrl,
				request.url,
				link.preserveQueryParams,
			);
			const cf = request.cf;

			const utm = extractUtmParams(request.url);

			waitUntil(
				(async () => {
					await recordRedirectEvent(db, {
						linkId: link.id,
						hostname: link.hostname,
						slug: link.slug,
						targetUrl: analyticsTarget,
						statusCode: link.statusCode,
						city: typeof cf?.city === "string" ? cf.city : null,
						colo: typeof cf?.colo === "string" ? cf.colo : null,
						country: typeof cf?.country === "string" ? cf.country : null,
						ipHash: await hashIp(getClientIp(request)),
						referer: request.headers.get("referer"),
						userAgent: request.headers.get("user-agent"),
						...utm,
					});
				})(),
			);

			return Response.redirect(
				redirectTarget,
				link.statusCode as RedirectStatusCode,
			);
		},
		{
			detail: {
				tags: ["Redirects"],
				summary: "Resolve and redirect short link",
			},
		},
	);

export type App = typeof app;
