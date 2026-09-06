import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { allowsSamlIdpInitiatedForRequest } from "../src/server/auth/saml-acs-policy";
import { createDb } from "../src/server/db/client";
import {
	SYSTEM_ROLE_OWNER,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../src/server/db/schema";
import { applyD1Migrations } from "./apply-d1-migrations";

const ORIGIN = "http://localhost:8787";
const PROVIDER_ID = "workforce";

function samlAcsRequest(providerId = PROVIDER_ID) {
	return new Request(`${ORIGIN}/api/auth/sso/saml2/sp/acs/${providerId}`, {
		body: new URLSearchParams({ SAMLResponse: "opaque-to-shorty" }),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

describe("SAML ACS IdP-initiation policy", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let db: ReturnType<typeof createDb>;

	beforeEach(async () => {
		mkdirSync("/tmp/wrangler-logs", { recursive: true });
		process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
		process.env.WRANGLER_LOG = "error";
		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		const database = (proxy.env as { DB: D1Database }).DB;
		db = createDb(database);
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
		await db.insert(ssoProvider).values({
			domain: "acme.test",
			id: "provider-row",
			issuer: "https://idp.example.test",
			oidcConfig: null,
			organizationId: null,
			providerId: PROVIDER_ID,
			samlConfig: "{}",
			userId: "owner",
		});
		await db.insert(ssoProviderSettings).values({
			allowIdpInitiated: false,
			createdAt: Date.now(),
			defaultRoleId: null,
			displayName: "Workforce",
			enabled: true,
			enforceSso: false,
			groupClaim: "groups",
			groupRoleMappings: "[]",
			jitEnabled: false,
			protocol: "saml",
			providerId: PROVIDER_ID,
			updatedAt: Date.now(),
		});
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("enables Better Auth IdP initiation only for an opted-in SAML provider", async () => {
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest(), db),
		).resolves.toBe(false);

		await db
			.update(ssoProviderSettings)
			.set({ allowIdpInitiated: true })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest(), db),
		).resolves.toBe(true);
	});

	it("fails closed for disabled, non-SAML, missing, and malformed providers", async () => {
		await db
			.update(ssoProviderSettings)
			.set({ allowIdpInitiated: true, enabled: false })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest(), db),
		).resolves.toBe(false);

		await db
			.update(ssoProviderSettings)
			.set({ enabled: true, protocol: "oidc" })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest(), db),
		).resolves.toBe(false);
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest("missing"), db),
		).resolves.toBe(false);
		await expect(
			allowsSamlIdpInitiatedForRequest(samlAcsRequest("%77orkforce"), db),
		).resolves.toBe(false);
	});

	it("does not enable IdP initiation outside the canonical ACS route", async () => {
		await db
			.update(ssoProviderSettings)
			.set({ allowIdpInitiated: true })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(
			allowsSamlIdpInitiatedForRequest(
				new Request(`${ORIGIN}/api/auth/sign-in/sso`, { method: "POST" }),
				db,
			),
		).resolves.toBe(false);
	});
});
