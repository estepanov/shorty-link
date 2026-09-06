import { env } from "cloudflare:workers";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { i18n } from "@better-auth/i18n";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { type Permission, parsePermissions } from "@/lib/permissions";

import { createDb } from "../db/client";
import {
	apiKey as apiKeyTable,
	passkey as passkeyTable,
	roles,
	SYSTEM_ROLE_ADMIN,
	schema,
	user,
} from "../db/schema";
import { extractIdpGroups } from "../services/sso-admission";
import {
	applySsoAdmission,
	assertPasskeyAllowed,
	loadSsoSettingsView,
	type PreparedSsoAdmission,
	prepareSsoAdmission,
} from "../services/sso-providers";
import {
	completePasskeyRegistrationUser,
	readOnboardingContext,
	resolvePasskeyRegistrationUser,
} from "./onboarding";
import { getAuthSecret } from "./secret";
import { resolveTrustedRequestOrigin, splitTrustedHosts } from "./security";
import { withSsoConfigCrypto } from "./sso-adapter";

const APIKEY_CREATE_PERMISSION: Permission = "apikeys.manage";
const SSO_ADMIN_PATHS = new Set([
	"/sso/register",
	"/sso/update-provider",
	"/sso/delete-provider",
]);

function resolveHookHeaders(context: {
	headers?: HeadersInit;
	request?: Request;
}) {
	return new Headers(context.headers ?? context.request?.headers);
}

function credentialIdToString(value: unknown) {
	if (typeof value === "string" && value) {
		return value;
	}
	if (value instanceof Uint8Array) {
		let binary = "";
		for (const byte of value) {
			binary += String.fromCharCode(byte);
		}
		return btoa(binary)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");
	}
	return null;
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

	return "[REDACTED]";
}

export function createAuth(request?: Request) {
	const db = createDb();
	let preparedSsoAdmission: PreparedSsoAdmission | null = null;
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
		database: withSsoConfigCrypto(
			drizzleAdapter(db, {
				provider: "sqlite",
				schema,
			}),
			getAuthSecret(request),
		),
		account: {
			additionalFields: {
				issuer: {
					type: "string",
					required: true,
					defaultValue: "local:unknown",
					input: false,
				},
			},
			accountLinking: {
				enabled: true,
			},
		},
		emailAndPassword: {
			enabled: false,
		},
		user: {
			additionalFields: {
				invitedBy: {
					type: "string",
					required: false,
					input: false,
				},
				isActive: {
					type: "boolean",
					required: false,
					defaultValue: true,
					input: false,
				},
				locale: {
					type: "string",
					required: false,
					defaultValue: "en",
				},
				roleId: {
					type: "string",
					required: false,
					defaultValue: SYSTEM_ROLE_ADMIN,
					input: false,
				},
			},
			changeEmail: {
				enabled: false,
			},
			validateUserInfo: async ({ user: providerUser, source }) => {
				if (source.method !== "sso-oidc" && source.method !== "sso-saml") {
					return;
				}
				const providerId = source.sso?.providerId;
				const email =
					typeof providerUser.email === "string" ? providerUser.email : "";
				const emailVerified = providerUser.emailVerified === true;
				if (!providerId) {
					return {
						error: "errors.ssoNotProvisioned",
						errorDescription: "errors.ssoNotProvisioned",
					};
				}
				const settings = await loadSsoSettingsView(db, providerId);
				const groups = extractIdpGroups(
					source.sso?.profile,
					settings?.groupClaim ?? "groups",
				);
				try {
					const prepared = await prepareSsoAdmission(db, {
						email,
						emailVerified,
						groups,
						providerId,
					});
					const isNewUser = source.action === "create-user";
					const isNewUserDecision =
						prepared.decision.action === "invite" ||
						prepared.decision.action === "jit";
					if (isNewUser !== isNewUserDecision) {
						throw new Error("errors.ssoNotProvisioned");
					}
					preparedSsoAdmission = prepared;
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "errors.ssoNotProvisioned";
					return { error: message, errorDescription: message };
				}
			},
		},
		databaseHooks: {
			account: {
				create: {
					before: async (newAccount) => {
						const prepared = preparedSsoAdmission;
						if (!prepared || newAccount.providerId !== prepared.providerId) {
							return;
						}
						return {
							data: {
								issuer: `local:${prepared.providerId}`,
							},
						};
					},
				},
			},
			user: {
				create: {
					before: async (newUser) => {
						const prepared = preparedSsoAdmission;
						if (
							!prepared ||
							newUser.email.trim().toLowerCase() !== prepared.email ||
							prepared.decision.action === "sign_in"
						) {
							return;
						}
						return {
							data: {
								invitedBy:
									prepared.decision.action === "invite"
										? prepared.decision.invitedBy
										: null,
								isActive: prepared.decision.action === "jit",
								roleId: prepared.decision.roleId,
							},
						};
					},
				},
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				const headers = resolveHookHeaders(ctx);
				if (SSO_ADMIN_PATHS.has(ctx.path)) {
					throw new APIError("FORBIDDEN", {
						message: "errors.permissionDenied",
					});
				}
				if (ctx.path !== "/api-key/create") {
					return;
				}
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
					afterVerification: async ({ context, user: passkeyUser }) => {
						if (context) {
							const parsed = await readOnboardingContext(context, request);
							await assertPasskeyAllowed(db, parsed.email, parsed.type);
						}
						return {
							userId: await completePasskeyRegistrationUser(
								db,
								context ?? undefined,
								passkeyUser.id,
								request,
							),
						};
					},
					extensions: { credProps: true },
				},
				authentication: {
					extensions: { credProps: true },
					afterVerification: async ({ verification }) => {
						const credentialID = credentialIdToString(
							verification.authenticationInfo?.credentialID,
						);
						if (!credentialID) {
							return;
						}
						const rows = await db
							.select({ email: user.email })
							.from(passkeyTable)
							.innerJoin(user, eq(passkeyTable.userId, user.id))
							.where(eq(passkeyTable.credentialID, credentialID))
							.limit(1);
						if (rows[0]) {
							await assertPasskeyAllowed(db, rows[0].email);
						}
					},
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
					const apiUser = rows[0];
					if (!apiUser || apiUser.isActive === false) {
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
			sso({
				disableImplicitSignUp: false,
				domainVerification: { enabled: false },
				organizationProvisioning: { disabled: true },
				provisionUserOnEveryLogin: true,
				trustEmailVerified: true,
				provisionUser: async ({ provider, user: authenticatedUser }) => {
					const prepared = preparedSsoAdmission;
					if (
						!prepared ||
						prepared.providerId !== provider.providerId ||
						prepared.email !== authenticatedUser.email.trim().toLowerCase()
					) {
						throw new Error("errors.ssoNotProvisioned");
					}
					await applySsoAdmission(db, prepared, authenticatedUser.id);
				},
			}),
			tanstackStartCookies(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;
