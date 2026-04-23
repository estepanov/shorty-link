import { env } from "cloudflare:workers";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { i18n } from "@better-auth/i18n";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { createDb } from "../db/client";
import { apiKey as apiKeyTable, schema, user } from "../db/schema";
import { isAdminRole } from "../services/links";
import {
	completePasskeyRegistrationUser,
	resolvePasskeyRegistrationUser,
} from "./onboarding";
import { getAuthSecret } from "./secret";

const runtimeEnv = env as typeof env & {
	BETTER_AUTH_ALLOWED_HOSTS?: string;
	BETTER_AUTH_FALLBACK_URL?: string;
	BETTER_AUTH_SECRET?: string;
	PASSKEY_RP_ID?: string;
	PASSKEY_RP_NAME?: string;
};

function splitHosts(value?: string) {
	return (value ?? "")
		.split(",")
		.map((host) => host.trim())
		.filter(Boolean);
}

function fallbackUrl(request?: Request) {
	if (runtimeEnv.BETTER_AUTH_FALLBACK_URL) {
		return runtimeEnv.BETTER_AUTH_FALLBACK_URL;
	}

	return request ? new URL(request.url).origin : "http://localhost:3000";
}

export function createAuth(request?: Request) {
	const db = createDb();
	const allowedHosts = splitHosts(runtimeEnv.BETTER_AUTH_ALLOWED_HOSTS);
	const origin = request ? new URL(request.url).origin : fallbackUrl();

	return betterAuth({
		appName: "Shorty Link",
		basePath: "/api/auth",
		baseURL: allowedHosts.length
			? {
					allowedHosts,
					fallback: fallbackUrl(request),
					protocol: "auto",
				}
			: origin,
		secret: getAuthSecret(request),
		trustedOrigins: (incomingRequest) => {
			const requestOrigin = incomingRequest
				? new URL(incomingRequest.url).origin
				: origin;
			return [requestOrigin, fallbackUrl(incomingRequest)];
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
				role: {
					type: "string",
					required: false,
					defaultValue: "admin",
				},
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
				const session = await createAuth(ctx.request).api.getSession({
					headers: ctx.request?.headers ?? new Headers(),
				});
				if (!session) {
					throw new APIError("UNAUTHORIZED", {
						message: "Authentication required",
					});
				}
				const authDb = createDb();
				const rows = await authDb
					.select({ role: user.role, isActive: user.isActive })
					.from(user)
					.where(eq(user.id, session.user.id))
					.limit(1);
				const u = rows[0];
				if (!u || !isAdminRole(u.role) || u.isActive === false) {
					throw new APIError("FORBIDDEN", {
						message: "Only active admins can create API keys",
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
						.select({ role: user.role, isActive: user.isActive })
						.from(user)
						.where(eq(user.id, keys[0].referenceId))
						.limit(1);
					const u = rows[0];
					if (!u || !isAdminRole(u.role) || u.isActive === false) {
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
