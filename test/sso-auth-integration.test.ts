import { env } from "cloudflare:workers";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { createAuth } from "../src/server/auth/auth";
import {
	account,
	adminInvites,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	schema,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../src/server/db/schema";
import { applyD1Migrations } from "./apply-d1-migrations";

type ProviderProfile = {
	email: string;
	emailVerified: boolean;
};

let APP_ORIGIN = "";
const PROVIDER_ID = "integration-oidc";
const runtimeEnv = env as unknown as Record<string, unknown>;

function base64url(value: string) {
	return Buffer.from(value).toString("base64url");
}

function stateCookie(response: Response) {
	const cookie = response.headers
		.getSetCookie()
		.find((value) => value.startsWith("better-auth.state="));
	if (!cookie) {
		throw new Error("Missing Better Auth state cookie");
	}
	return cookie.split(";")[0];
}

async function createProvider() {
	const profile: ProviderProfile = {
		email: "member@acme.test",
		emailVerified: true,
	};
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const publicJwk = {
		...publicKey.export({ format: "jwk" }),
		alg: "RS256",
		kid: "integration-sso",
		use: "sig",
	};
	const nonces = new Map<string, string | null>();
	let origin = "";
	let issuer = "";

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", origin);
		const writeJson = (status: number, value: unknown) => {
			response.statusCode = status;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(value));
		};

		if (url.pathname === "/.well-known/openid-configuration") {
			writeJson(200, {
				authorization_endpoint: `${issuer}/authorize`,
				id_token_signing_alg_values_supported: ["RS256"],
				issuer,
				jwks_uri: `${issuer}/jwks`,
				response_types_supported: ["code"],
				scopes_supported: ["openid", "email", "profile"],
				subject_types_supported: ["public"],
				token_endpoint: `${issuer}/token`,
				token_endpoint_auth_methods_supported: ["client_secret_basic"],
				userinfo_endpoint: `${issuer}/userinfo`,
			});
			return;
		}
		if (url.pathname === "/authorize") {
			const redirectUri = url.searchParams.get("redirect_uri");
			const state = url.searchParams.get("state");
			if (!redirectUri || !state) {
				writeJson(400, { error: "invalid_request" });
				return;
			}
			const code = crypto.randomUUID();
			nonces.set(code, url.searchParams.get("nonce"));
			const callback = new URL(redirectUri);
			callback.searchParams.set("code", code);
			callback.searchParams.set("state", state);
			response.statusCode = 302;
			response.setHeader("location", callback.toString());
			response.end();
			return;
		}
		if (url.pathname === "/token") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
			const code = body.get("code");
			if (!code || !nonces.has(code)) {
				writeJson(400, { error: "invalid_grant" });
				return;
			}
			const now = Math.floor(Date.now() / 1000);
			const unsigned = `${base64url(
				JSON.stringify({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" }),
			)}.${base64url(
				JSON.stringify({
					aud: "integration-client",
					email: profile.email,
					email_verified: profile.emailVerified,
					exp: now + 300,
					groups: ["engineering"],
					iat: now,
					iss: issuer,
					name: "Integration Member",
					nonce: nonces.get(code),
					sub: "integration-subject",
				}),
			)}`;
			nonces.delete(code);
			writeJson(200, {
				access_token: "integration-access-token",
				expires_in: 300,
				id_token: `${unsigned}.${sign(
					"RSA-SHA256",
					Buffer.from(unsigned),
					privateKey,
				).toString("base64url")}`,
				token_type: "Bearer",
			});
			return;
		}
		if (url.pathname === "/jwks") {
			writeJson(200, { keys: [publicJwk] });
			return;
		}
		if (url.pathname === "/userinfo") {
			writeJson(200, {
				email: profile.email,
				email_verified: profile.emailVerified,
				groups: ["engineering"],
				name: "Integration Member",
				sub: "integration-subject",
			});
			return;
		}
		writeJson(404, { error: "not_found" });
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Unable to bind integration provider");
	}
	origin = `http://127.0.0.1:${address.port}`;
	issuer = origin;
	return { issuer, profile, server };
}

async function completeOidcFlow() {
	const start = await createAuth(
		new Request(`${APP_ORIGIN}/api/auth/sign-in/sso`),
	).handler(
		new Request(`${APP_ORIGIN}/api/auth/sign-in/sso`, {
			body: JSON.stringify({
				callbackURL: "/admin",
				errorCallbackURL: "/api/auth/error",
				providerId: PROVIDER_ID,
			}),
			headers: {
				"content-type": "application/json",
				origin: APP_ORIGIN,
			},
			method: "POST",
		}),
	);
	const body = (await start.json()) as { url: string };
	const authorization = await fetch(body.url, { redirect: "manual" });
	const callbackUrl = authorization.headers.get("location");
	if (!callbackUrl) {
		throw new Error("Missing provider callback");
	}
	return createAuth(new Request(callbackUrl)).handler(
		new Request(callbackUrl, {
			headers: { cookie: stateCookie(start) },
		}),
	);
}

describe("Better Auth SSO on D1", () => {
	let db: ReturnType<typeof drizzle<typeof schema>>;
	let providerServer: Server | null = null;
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let profile: ProviderProfile;

	beforeEach(async () => {
		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		const database = (proxy.env as { DB: D1Database }).DB;
		await applyD1Migrations(database);
		db = drizzle(database, { schema });
		const provider = await createProvider();
		providerServer = provider.server;
		profile = provider.profile;
		APP_ORIGIN = provider.issuer;
		Object.assign(runtimeEnv, {
			BETTER_AUTH_ALLOWED_HOSTS: new URL(APP_ORIGIN).host,
			BETTER_AUTH_FALLBACK_URL: APP_ORIGIN,
			BETTER_AUTH_SECRET: "integration-better-auth-secret-32-bytes",
			DB: database,
			PASSKEY_RP_ID: "127.0.0.1",
		});

		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: "owner@acme.test",
			emailVerified: true,
			id: "owner",
			image: null,
			isActive: true,
			locale: "en",
			name: "Owner",
			roleId: SYSTEM_ROLE_OWNER,
			updatedAt: timestamp,
		});
		await db.insert(ssoProvider).values({
			domain: "acme.test",
			id: "provider-row",
			issuer: provider.issuer,
			oidcConfig: JSON.stringify({
				authorizationEndpoint: `${provider.issuer}/authorize`,
				clientId: "integration-client",
				clientSecret: "integration-secret",
				issuer: provider.issuer,
				jwksEndpoint: `${provider.issuer}/jwks`,
				pkce: true,
				tokenEndpoint: `${provider.issuer}/token`,
				userInfoEndpoint: `${provider.issuer}/userinfo`,
			}),
			organizationId: null,
			providerId: PROVIDER_ID,
			samlConfig: null,
			userId: "owner",
		});
		await db.insert(ssoProviderSettings).values({
			allowIdpInitiated: false,
			createdAt: Date.now(),
			defaultRoleId: SYSTEM_ROLE_ADMIN,
			displayName: "Integration",
			enabled: true,
			enforceSso: true,
			groupClaim: "groups",
			groupRoleMappings: "[]",
			jitEnabled: true,
			protocol: "oidc",
			providerId: PROVIDER_ID,
			updatedAt: Date.now(),
		});
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			if (!providerServer) {
				resolve();
				return;
			}
			providerServer.close((error) => (error ? reject(error) : resolve()));
		});
		providerServer = null;
		await proxy?.dispose();
		proxy = null;
		for (const key of Object.keys(runtimeEnv)) {
			delete runtimeEnv[key];
		}
	});

	it("JIT provisions a verified user without native transactions", async () => {
		const callback = await completeOidcFlow();
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe("/admin");
		expect(
			callback.headers
				.getSetCookie()
				.some((cookie) => cookie.startsWith("better-auth.session_token=")),
		).toBe(true);

		const [member] = await db
			.select()
			.from(user)
			.where(eq(user.email, profile.email));
		const [linkedAccount] = await db
			.select()
			.from(account)
			.where(eq(account.userId, member?.id ?? ""));
		expect(member).toMatchObject({
			emailVerified: true,
			isActive: true,
			roleId: SYSTEM_ROLE_ADMIN,
		});
		expect(linkedAccount).toMatchObject({
			issuer: `local:${PROVIDER_ID}`,
			providerId: PROVIDER_ID,
		});
	});

	it("claims an invite before activating and signing in the new user", async () => {
		await db
			.update(ssoProviderSettings)
			.set({ jitEnabled: false })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await db.insert(adminInvites).values({
			acceptedAt: null,
			createdAt: Date.now(),
			email: profile.email,
			expiresAt: Date.now() + 60_000,
			id: "integration-invite",
			invitedBy: "owner",
			roleId: SYSTEM_ROLE_ADMIN,
			ssoClaimId: null,
			token: "integration-invite-token",
		});

		const callback = await completeOidcFlow();
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe("/admin");

		const [member] = await db
			.select()
			.from(user)
			.where(eq(user.email, profile.email));
		const [invite] = await db
			.select()
			.from(adminInvites)
			.where(eq(adminInvites.id, "integration-invite"));
		expect(member).toMatchObject({
			invitedBy: "owner",
			isActive: true,
			roleId: SYSTEM_ROLE_ADMIN,
		});
		expect(invite).toMatchObject({
			acceptedAt: expect.any(Number),
			ssoClaimId: expect.any(String),
		});
	});

	it("rejects an unverified IdP email without creating a user", async () => {
		profile.emailVerified = false;
		const callback = await completeOidcFlow();
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toContain(
			"error=errors.ssoEmailUnverified",
		);
		expect(
			await db.select().from(user).where(eq(user.email, profile.email)),
		).toHaveLength(0);
	});

	it("rejects a verified identity outside the selected provider domain", async () => {
		profile.email = "outsider@other.test";
		const callback = await completeOidcFlow();
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toContain(
			"error=errors.ssoNotProvisioned",
		);
		expect(
			await db.select().from(user).where(eq(user.email, profile.email)),
		).toHaveLength(0);
	});
});
