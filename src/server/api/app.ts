import { env, waitUntil } from "cloudflare:workers";
import { serverTiming } from "@elysiajs/server-timing";
import { and, eq, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

import { createTranslator, normalizeLocale } from "@/lib/i18n";
import {
	isRedirectStatusCode,
	type RedirectStatusCode,
} from "@/lib/redirect-status";
import { createAuth } from "../auth/auth";
import {
	createBootstrapContext,
	createInviteContext,
} from "../auth/onboarding";
import { assertTrustedAdminWrite } from "../auth/security";
import { getSession, requireAdmin } from "../auth/session";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import {
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
	listDomains,
	listShortLinks,
	recordRedirectEvent,
	resolveRedirect,
	saveDomain,
	saveLink,
	suggestSlugFromUrl,
} from "../services/links";
import {
	deleteInvite,
	deleteUser,
	listAllInvites,
	listUsers,
	toggleUserActive,
} from "../services/users";

type AiBinding = {
	run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

const runtimeEnv = env as typeof env & {
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

async function jsonError(error: unknown, request: Request) {
	const tMessage = createTranslator(localeFromRequest(request));

	if (error instanceof Response) {
		return Response.json(
			{
				code: "AUTH_ERROR",
				message: tMessage(await error.text()),
			},
			{ status: error.status },
		);
	}

	const key = error instanceof Error ? error.message : "errors.unknown";
	return Response.json(
		{
			code: key,
			message: tMessage(key),
		},
		{ status: 400 },
	);
}

async function requireAdminOrError(request: Request) {
	try {
		return await requireAdmin(request);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}

		throw new Response("errors.unauthorized", { status: 401 });
	}
}

async function requireSecureAdminSession(request: Request) {
	assertTrustedAdminWrite(request);
	return requireAdminOrError(request);
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

async function signOutResponse(request: Request) {
	const url = new URL("/api/auth/sign-out", request.url);

	return createAuth(request).handler(
		new Request(url, {
			headers: request.headers,
			method: "POST",
		}),
	);
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
	.get("/api/health", () => ({
		ok: true,
		service: "shorty-link",
	}))
	.group("/api/admin", (admin) =>
		admin
			.get("/bootstrap", ({ db }) => getBootstrapState(db))
			.post(
				"/onboarding/bootstrap",
				async ({ body, db, request }) => {
					assertTrustedAdminWrite(request);
					return {
						context: await createBootstrapContext(db, body, request),
					};
				},
				{
					body: t.Object({
						email: t.String({ format: "email" }),
						locale: t.Optional(t.String()),
						name: t.String({ minLength: 2 }),
					}),
				},
			)
			.get(
				"/invites/:token",
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
					params: t.Object({
						token: t.String({ minLength: 16 }),
					}),
				},
			)
			.post(
				"/onboarding/invite",
				async ({ body, db, request }) => {
					assertTrustedAdminWrite(request);
					await requireSignedOutInviteRequest(request);
					return {
						context: await createInviteContext(db, body, request),
					};
				},
				{
					body: t.Object({
						locale: t.Optional(t.String()),
						name: t.String({ minLength: 2 }),
						token: t.String({ minLength: 16 }),
					}),
				},
			)
			.get("/dashboard", async ({ db, request }) => {
				const session = await requireAdminOrError(request);
				const dashboard = await getDashboardData(db);
				const origin = new URL(request.url).origin;

				return {
					...dashboard,
					invites: dashboard.invites.map((invite) => ({
						...invite,
						inviteUrl: buildInviteUrl(origin, invite.token),
					})),
					session,
				};
			})
			.get("/profile", async ({ request }) => {
				const session = await requireAdminOrError(request);
				return session.user;
			})
			.patch(
				"/profile",
				async ({ body, db, request }) => {
					const session = await requireSecureAdminSession(request);
					const email = body.email.trim().toLowerCase();
					const existing = await db
						.select({ id: user.id })
						.from(user)
						.where(and(eq(user.email, email), ne(user.id, session.user.id)))
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
						.where(eq(user.id, session.user.id));

					return { ok: true };
				},
				{
					body: t.Object({
						email: t.String({ format: "email" }),
						locale: t.Optional(t.String()),
						name: t.String({ minLength: 2 }),
					}),
				},
			)
			.get(
				"/links",
				async ({ db, query, request }) => {
					await requireAdminOrError(request);
					return listShortLinks(db, {
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
					});
				},
				{
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
						statusCode: t.Optional(redirectStatusCodeSchema),
					}),
				},
			)
			.post(
				"/links",
				async ({ body, db, request }) => {
					const session = await requireSecureAdminSession(request);
					return {
						id: await saveLink(db, {
							...body,
							createdBy: session.user.id,
						}),
					};
				},
				{ body: linkBody },
			)
			.get(
				"/links/:id",
				async ({ db, params, request }) => {
					await requireAdminOrError(request);
					const link = await getLinkById(db, params.id);
					if (!link) {
						throw new Error("errors.linkMissing");
					}

					return link;
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/links/:id/stats",
				async ({ db, params, query, request }) => {
					await requireAdminOrError(request);
					const link = await getLinkById(db, params.id);
					if (!link) {
						throw new Error("errors.linkMissing");
					}

					const stats = await getLinkStats(db, params.id, {
						days: query.days,
					});

					return { link, stats };
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
					query: t.Object({
						days: t.Optional(t.Number({ minimum: 1, maximum: 180 })),
					}),
				},
			)
			.patch(
				"/links/:id",
				async ({ body, db, params, request }) => {
					const session = await requireSecureAdminSession(request);
					return {
						id: await saveLink(db, {
							...body,
							id: params.id,
							createdBy: session.user.id,
						}),
					};
				},
				{
					body: linkBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/links/:id",
				async ({ db, params, request }) => {
					await requireSecureAdminSession(request);
					await deleteLink(db, params.id);
					return { ok: true };
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get("/domains", async ({ db, request }) => {
				await requireAdminOrError(request);
				return listDomains(db);
			})
			.post(
				"/domains",
				async ({ body, db, request }) => {
					const session = await requireSecureAdminSession(request);
					return {
						id: await saveDomain(db, {
							...body,
							createdBy: session.user.id,
						}),
					};
				},
				{ body: domainBody },
			)
			.get(
				"/domains/:id",
				async ({ db, params, request }) => {
					await requireAdminOrError(request);
					const domain = await getDomainById(db, params.id);
					if (!domain) {
						throw new Error("errors.domainMissing");
					}

					return domain;
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.patch(
				"/domains/:id",
				async ({ body, db, params, request }) => {
					const session = await requireSecureAdminSession(request);
					return {
						id: await saveDomain(db, {
							...body,
							id: params.id,
							createdBy: session.user.id,
						}),
					};
				},
				{
					body: domainBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/domains/:id",
				async ({ db, params, request }) => {
					await requireSecureAdminSession(request);
					await deleteDomain(db, params.id);
					return { ok: true };
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.post(
				"/invites",
				async ({ body, db, request }) => {
					const session = await requireSecureAdminSession(request);
					const invite = await createInvite(db, {
						email: body.email,
						expiresInDays: body.expiresInDays,
						invitedBy: session.user.id,
						role: "admin",
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
					body: t.Object({
						email: t.String({ format: "email" }),
						expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
					}),
				},
			)
			.get("/users", async ({ db, request }) => {
				await requireAdminOrError(request);
				return listUsers(db);
			})
			.patch(
				"/users/:id",
				async ({ body, db, params, request }) => {
					const session = await requireSecureAdminSession(request);
					if (params.id === session.user.id) {
						throw new Error("errors.cannotSelfDisable");
					}
					await toggleUserActive(db, params.id, body.isActive);
					return { ok: true };
				},
				{
					body: t.Object({
						isActive: t.Boolean(),
					}),
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/users/:id",
				async ({ db, params, request }) => {
					const session = await requireSecureAdminSession(request);
					if (params.id === session.user.id) {
						throw new Error("errors.cannotSelfDelete");
					}
					await deleteUser(db, params.id);
					return { ok: true };
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get("/sessions", async ({ request }) => {
				await requireAdminOrError(request);
				return createAuth(request).api.listSessions({
					headers: request.headers,
				});
			})
			.post(
				"/sessions/revoke",
				async ({ body, request }) => {
					await requireSecureAdminSession(request);
					return createAuth(request).api.revokeSession({
						body,
						headers: request.headers,
					});
				},
				{
					body: t.Object({
						token: t.String({ minLength: 1 }),
					}),
				},
			)
			.post("/sessions/revoke-other", async ({ request }) => {
				await requireSecureAdminSession(request);
				return createAuth(request).api.revokeOtherSessions({
					headers: request.headers,
				});
			})
			.delete("/sessions/current", async ({ request }) => {
				await requireSecureAdminSession(request);
				return signOutResponse(request);
			})
			.get(
				"/api-keys",
				async ({ query, request }) => {
					await requireAdminOrError(request);
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
					query: apiKeyListQuery,
				},
			)
			.post(
				"/api-keys",
				async ({ body, request }) => {
					await requireSecureAdminSession(request);
					return createAuth(request).api.createApiKey({
						body: {
							expiresIn: expiresInSeconds(body.expiresInDays),
							name: body.name,
						},
						headers: request.headers,
					});
				},
				{
					body: apiKeyCreateBody,
				},
			)
			.patch(
				"/api-keys/:id",
				async ({ body, params, request }) => {
					await requireSecureAdminSession(request);
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
					body: apiKeyUpdateBody,
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.delete(
				"/api-keys/:id",
				async ({ params, request }) => {
					await requireSecureAdminSession(request);
					return createAuth(request).api.deleteApiKey({
						body: { keyId: params.id },
						headers: request.headers,
					});
				},
				{
					params: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get("/invites", async ({ db, request }) => {
				await requireAdminOrError(request);
				const invites = await listAllInvites(db);
				const origin = new URL(request.url).origin;
				return invites.map((invite) => ({
					...invite,
					inviteUrl: invite.acceptedAt
						? null
						: buildInviteUrl(origin, invite.token),
				}));
			})
			.delete(
				"/invites",
				async ({ body, db, request }) => {
					await requireSecureAdminSession(request);
					await deleteInvite(db, body.id);
					return { ok: true };
				},
				{
					body: t.Object({ id: t.String({ minLength: 1 }) }),
				},
			)
			.get(
				"/suggest-slug",
				async ({ query, request }) => {
					await requireAdminOrError(request);
					return { slug: await suggestSlugWithAi(query.targetUrl) };
				},
				{
					query: t.Object({
						targetUrl: t.String({ minLength: 1 }),
					}),
				},
			),
	)
	.get("/*", async ({ db, request }) => {
		const url = new URL(request.url);
		const tMessage = createTranslator(localeFromRequest(request));
		const slug = url.pathname.replace(/^\/+/, "");

		if (!slug) {
			return new Response(tMessage("redirect.online"), { status: 200 });
		}

		const link = await resolveRedirect(db, {
			hostname: url.hostname.toLowerCase(),
			slug,
		});

		if (!link) {
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
	});

export type App = typeof app;
