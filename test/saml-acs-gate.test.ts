import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import {
	MAX_SAML_RESPONSE_BASE64_BYTES,
	validateSamlAcsRequest,
} from "../src/server/auth/saml-acs-gate";
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

function samlAcsRequest(xml: string, providerId = PROVIDER_ID) {
	return new Request(`${ORIGIN}/api/auth/sso/saml2/sp/acs/${providerId}`, {
		body: new URLSearchParams({
			SAMLResponse: Buffer.from(xml).toString("base64"),
		}),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

describe("SAML ACS pre-validation", () => {
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

	it("allows unsolicited responses only for an enabled SAML provider that opts in", async () => {
		const request = samlAcsRequest(
			'<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Assertion /></samlp:Response>',
		);
		await expect(validateSamlAcsRequest(request, db)).resolves.toEqual({
			allowed: false,
			reason: "idp_initiated_not_allowed",
			status: 403,
		});

		await db
			.update(ssoProviderSettings)
			.set({ allowIdpInitiated: true })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(validateSamlAcsRequest(request, db)).resolves.toEqual({
			allowed: true,
		});

		await db
			.update(ssoProviderSettings)
			.set({ enabled: false })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(validateSamlAcsRequest(request, db)).resolves.toMatchObject({
			allowed: false,
			reason: "idp_initiated_not_allowed",
		});

		await db
			.update(ssoProviderSettings)
			.set({ enabled: true, protocol: "oidc" })
			.where(eq(ssoProviderSettings.providerId, PROVIDER_ID));
		await expect(validateSamlAcsRequest(request, db)).resolves.toMatchObject({
			allowed: false,
			reason: "idp_initiated_not_allowed",
		});
	});

	it("passes correlated responses through for Better Auth validation", async () => {
		const request = samlAcsRequest(
			'<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" InResponseTo="_request-id"><Assertion /></samlp:Response>',
		);
		await expect(validateSamlAcsRequest(request, db)).resolves.toEqual({
			allowed: true,
		});
	});

	it("does not mistake an assertion attribute for response correlation", async () => {
		const request = samlAcsRequest(
			'<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Assertion InResponseTo="_not-a-request" /></samlp:Response>',
		);
		await expect(validateSamlAcsRequest(request, db)).resolves.toMatchObject({
			allowed: false,
			reason: "idp_initiated_not_allowed",
		});
	});

	it("applies the provider gate after decoding the ACS path parameter", async () => {
		const request = samlAcsRequest(
			'<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><Assertion /></samlp:Response>',
			"%77orkforce",
		);
		await expect(validateSamlAcsRequest(request, db)).resolves.toMatchObject({
			allowed: false,
			reason: "idp_initiated_not_allowed",
		});
	});

	it("fails closed on malformed and oversized SAML responses", async () => {
		const malformed = new Request(
			`${ORIGIN}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`,
			{
				body: new URLSearchParams({ SAMLResponse: "not base64!" }),
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			},
		);
		await expect(validateSamlAcsRequest(malformed, db)).resolves.toEqual({
			allowed: false,
			reason: "invalid_request",
			status: 400,
		});

		const duplicate = new URLSearchParams();
		duplicate.append(
			"SAMLResponse",
			Buffer.from("<Response />").toString("base64"),
		);
		duplicate.append(
			"SAMLResponse",
			Buffer.from('<Response InResponseTo="_request" />').toString("base64"),
		);
		await expect(
			validateSamlAcsRequest(
				new Request(`${ORIGIN}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`, {
					body: duplicate,
					headers: {
						"content-type": "application/x-www-form-urlencoded",
					},
					method: "POST",
				}),
				db,
			),
		).resolves.toMatchObject({
			allowed: false,
			reason: "invalid_request",
		});

		const oversized = new Request(
			`${ORIGIN}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`,
			{
				body: JSON.stringify({
					SAMLResponse: "A".repeat(MAX_SAML_RESPONSE_BASE64_BYTES + 1),
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		);
		await expect(validateSamlAcsRequest(oversized, db)).resolves.toEqual({
			allowed: false,
			reason: "invalid_request",
			status: 400,
		});
	});
});
