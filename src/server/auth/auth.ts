import { env } from "cloudflare:workers";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { i18n } from "@better-auth/i18n";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { type Permission, parsePermissions } from "@/lib/permissions";

import { createDb } from "../db/client";
import { apiKey as apiKeyTable, roles, schema, user } from "../db/schema";
import {
	completePasskeyRegistrationUser,
	resolvePasskeyRegistrationUser,
} from "./onboarding";
import { getAuthSecret } from "./secret";
import { resolveTrustedRequestOrigin, splitTrustedHosts } from "./security";

const APIKEY_CREATE_PERMISSION: Permission = "apikeys.manage";

function resolveHookHeaders(context: {
	headers?: HeadersInit;
	request?: Request;
}) {
	return new Headers(context.headers ?? context.request?.headers);
}

async function userHasPermission(
	authDb: ReturnType<typeof createDb>,
	userId: string,
	permission: Permission,
): Promise<boolean> {
	const rows = await authDb
		.select({
			isActive: user.isActive,
			permissions: roles.permissions,
		})
		.from(user)
		.innerJoin(roles, eq(user.roleId, roles.id))
		.where(eq(user.id, userId))
		.limit(1);
	const row = rows[0];
	if (!row || row.isActive === false) {
		return false;
	}
	return parsePermissions(row.permissions).has(permission);
}

const runtimeEnv = env as typeof env & {
	BETTER_AUTH_ALLOWED_HOSTS?: string;
	BETTER_AUTH_FALLBACK_URL?: string;
	BETTER_AUTH_SECRET?: string;
	PASSKEY_RP_ID?: string;
	PASSKEY_RP_NAME?: string;
};

function fallbackUrl(request?: Request) {
	if (runtimeEnv.BETTER_AUTH_FALLBACK_URL) {
		return runtimeEnv.BETTER_AUTH_FALLBACK_URL;
	}

	if (request) {
		const trustedOrigin = resolveTrustedRequestOrigin(request);
		if (trustedOrigin) {
			return trustedOrigin;
		}
	}

	return "http://localhost:3000";
}

export function createAuth(request?: Request) {
	const db = createDb();
	const allowedHosts = splitTrustedHosts(runtimeEnv.BETTER_AUTH_ALLOWED_HOSTS);
	const configuredFallback = runtimeEnv.BETTER_AUTH_FALLBACK_URL ?? null;
	const trustedRequestOrigin = request
		? resolveTrustedRequestOrigin(request, {
				allowedHosts,
				fallbackOrigin: configuredFallback,
			})
		: null;

	if (request && !trustedRequestOrigin) {
		throw new Error("Untrusted auth host");
	}

	const origin = trustedRequestOrigin ?? fallbackUrl(request);
	const fallback = configuredFallback ?? origin;

	return betterAuth({
		appName: "Shorty Link",
		basePath: "/api/auth",
		baseURL: allowedHosts.length
			? {
					allowedHosts,
					fallback,
					protocol: "auto",
				}
			: origin,
		secret: getAuthSecret(request),
		trustedOrigins: (incomingRequest) => {
			const nextRequestOrigin = incomingRequest
				? resolveTrustedRequestOrigin(incomingRequest, {
						allowedHosts,
						fallbackOrigin: configuredFallback,
					})
				: origin;
			return [...new Set([nextRequestOrigin, fallback].filter(Boolean))];
		},
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		emailAndPassword: {
			enabled: false,
		},
		user: {
			additionalFields: {
				locale: {
					type: "string",
					required: false,
					defaultValue: "en",
				},
			},
			changeEmail: {
				enabled: false,
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/api-key/create") {
					return;
				}
				const headers = resolveHookHeaders(ctx);
				const authRequest =
					ctx.request ??
					new Request(`${origin}/api/auth/api-key/create`, { headers });
				const session = await createAuth(authRequest).api.getSession({
					headers,
				});
				if (!session) {
					throw new APIError("UNAUTHORIZED", {
						message: "Authentication required",
					});
				}
				const allowed = await userHasPermission(
					createDb(),
					session.user.id,
					APIKEY_CREATE_PERMISSION,
				);
				if (!allowed) {
					throw new APIError("FORBIDDEN", {
						message:
							"You need the 'apikeys.manage' permission to manage API keys",
					});
				}
			}),
		},
		plugins: [
			passkey({
				origin,
				rpID: runtimeEnv.PASSKEY_RP_ID ?? new URL(origin).hostname,
				rpName: runtimeEnv.PASSKEY_RP_NAME ?? "Shorty Link",
				registration: {
					requireSession: false,
					resolveUser: async ({ context }) =>
						resolvePasskeyRegistrationUser(db, context ?? undefined, request),
					afterVerification: async ({ context, user }) => ({
						userId: await completePasskeyRegistrationUser(
							db,
							context ?? undefined,
							user.id,
							request,
						),
					}),
					extensions: { credProps: true },
				},
				authentication: {
					extensions: { credProps: true },
				},
			}),
			apiKey({
				apiKeyHeaders: ["x-api-key", "authorization"],
				defaultPrefix: "sl_",
				enableSessionForAPIKeys: true,
				requireName: true,
				rateLimit: {
					enabled: true,
					maxRequests: 120,
					timeWindow: 60_000,
				},
				customAPIKeyValidator: async ({ key }) => {
					const authDb = createDb();
					const hash = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(key),
					);
					const hashed = btoa(String.fromCharCode(...new Uint8Array(hash)))
						.replace(/\+/g, "-")
						.replace(/\//g, "_")
						.replace(/=/g, "");
					const keys = await authDb
						.select({ referenceId: apiKeyTable.referenceId })
						.from(apiKeyTable)
						.where(eq(apiKeyTable.key, hashed))
						.limit(1);
					if (!keys[0]) {
						return true;
					}
					const rows = await authDb
						.select({ isActive: user.isActive })
						.from(user)
						.where(eq(user.id, keys[0].referenceId))
						.limit(1);
					const u = rows[0];
					if (!u || u.isActive === false) {
						return false;
					}
					return true;
				},
			}),
			i18n({
				translations: {
					es: {
						USER_NOT_FOUND: "Usuario no encontrado",
						INVALID_EMAIL_OR_PASSWORD: "Email o contrasena invalida",
						INVALID_PASSWORD: "Contrasena invalida",
						SESSION_EXPIRED: "La sesion expiro",
					},
				},
				detection: ["session", "cookie", "header"],
				localeCookie: "shorty_locale",
				userLocaleField: "locale",
			}),
			tanstackStartCookies(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;
