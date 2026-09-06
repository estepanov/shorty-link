import { mkdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";

import type { SsoOidcProviderWrite } from "../src/lib/sso-types";
import { SYSTEM_ROLE_OWNER, schema, user } from "../src/server/db/schema";
import { applyD1Migrations } from "./apply-d1-migrations";

export const SSO_TEST_ORIGIN = "http://localhost:8787";
export const SSO_TEST_REQUEST = new Request(
	`${SSO_TEST_ORIGIN}/api/admin/sso-providers`,
);

export const VALID_SAML_METADATA =
	'<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/></IDPSSODescriptor></EntityDescriptor>';

export function oidcProviderInput(
	overrides: Partial<SsoOidcProviderWrite> = {},
): SsoOidcProviderWrite {
	return {
		clientId: "client-id",
		clientSecret: "client-secret",
		displayName: "Workforce",
		domain: "acme.test",
		issuer: "https://idp.example.test",
		oidcConfig: {
			authorizationEndpoint: "https://idp.example.test/authorize",
			jwksEndpoint: "https://idp.example.test/jwks",
			skipDiscovery: true,
			tokenEndpoint: "https://idp.example.test/token",
		},
		protocol: "oidc",
		providerId: "workforce",
		...overrides,
	};
}

export async function createSsoProviderD1Fixture() {
	mkdirSync("/tmp/wrangler-logs", { recursive: true });
	process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
	process.env.WRANGLER_LOG = "error";
	const proxy = await getPlatformProxy({
		configPath: "wrangler.jsonc",
		persist: false,
		remoteBindings: false,
	});
	const database = (proxy.env as { DB: D1Database }).DB;
	const db = drizzle(database, { schema });
	await applyD1Migrations(database);

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

	return {
		database,
		db,
		dispose: () => proxy.dispose(),
	};
}
