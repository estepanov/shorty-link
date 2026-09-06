import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
	DEFAULT_SAML_ATTRIBUTE_MAPPING,
	type SsoProviderWrite,
} from "../src/lib/sso-types";
import {
	account,
	roles,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	schema,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../src/server/db/schema";
import {
	createSsoProvider,
	deleteSsoProvider,
	updateSsoProvider,
} from "../src/server/services/sso-providers";
import { applyD1Migrations } from "./apply-d1-migrations";

const ORIGIN = "http://localhost:8787";
const REQUEST = new Request(`${ORIGIN}/api/admin/sso-providers`);

function oidcInput(
	overrides: Partial<SsoProviderWrite> = {},
): SsoProviderWrite {
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

const validSamlMetadata =
	'<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/></IDPSSODescriptor></EntityDescriptor>';

describe("D1 SSO provider persistence", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let database: D1Database;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(async () => {
		mkdirSync("/tmp/wrangler-logs", { recursive: true });
		process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
		process.env.WRANGLER_LOG = "error";
		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		database = (proxy.env as { DB: D1Database }).DB;
		db = drizzle(database, { schema });
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
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await proxy?.dispose();
		proxy = null;
	});

	it("preserves allowIdpInitiated in OIDC runtime config on an unrelated patch", async () => {
		await createSsoProvider(
			db,
			oidcInput({ allowIdpInitiated: true }),
			"owner",
			ORIGIN,
			REQUEST,
		);

		const updated = await updateSsoProvider(
			db,
			"workforce",
			{ displayName: "Renamed workforce" },
			ORIGIN,
			REQUEST,
		);

		expect(updated.allowIdpInitiated).toBe(true);
		expect(updated.oidcConfig?.allowIdpInitiated).toBe(true);
		expect(updated.oidcConfig).not.toHaveProperty("mapping");
		expect(updated.samlConfig).toBeNull();
	});

	it("validates role references before creating or updating a provider", async () => {
		await expect(
			createSsoProvider(
				db,
				oidcInput({ defaultRoleId: "missing-role" }),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.roleMissing");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);

		await createSsoProvider(
			db,
			oidcInput({
				defaultRoleId: SYSTEM_ROLE_ADMIN,
				groupRoleMappings: [{ group: "admins", roleId: SYSTEM_ROLE_ADMIN }],
			}),
			"owner",
			ORIGIN,
			REQUEST,
		);
		const [providerBefore] = await db.select().from(ssoProvider);
		const [settingsBefore] = await db.select().from(ssoProviderSettings);

		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{
					domain: "changed.test",
					groupRoleMappings: [{ group: "eng", roleId: "missing-role" }],
				},
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.roleMissing");

		expect(await db.select().from(ssoProvider)).toEqual([providerBefore]);
		expect(await db.select().from(ssoProviderSettings)).toEqual([
			settingsBefore,
		]);
	});

	it("keeps automatic system_owner assignment forbidden", async () => {
		await expect(
			createSsoProvider(
				db,
				oidcInput({
					defaultRoleId: SYSTEM_ROLE_OWNER,
					jitEnabled: true,
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoOwnerRoleForbidden");
		await expect(
			createSsoProvider(
				db,
				oidcInput({
					groupRoleMappings: [{ group: "owners", roleId: SYSTEM_ROLE_OWNER }],
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoOwnerRoleForbidden");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
	});

	it("rejects JIT provisioning without a non-empty default role before writing", async () => {
		await expect(
			createSsoProvider(
				db,
				oidcInput({ defaultRoleId: " ", jitEnabled: true }),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);

		await createSsoProvider(
			db,
			oidcInput({ defaultRoleId: SYSTEM_ROLE_ADMIN }),
			"owner",
			ORIGIN,
			REQUEST,
		);
		const [providerBefore] = await db.select().from(ssoProvider);
		const [settingsBefore] = await db.select().from(ssoProviderSettings);

		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{ defaultRoleId: null, jitEnabled: true },
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		expect(await db.select().from(ssoProvider)).toEqual([providerBefore]);
		expect(await db.select().from(ssoProviderSettings)).toEqual([
			settingsBefore,
		]);
	});

	it("requires complete OIDC credentials and manual endpoints", async () => {
		await expect(
			createSsoProvider(
				db,
				oidcInput({ clientSecret: " " }),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		await expect(
			createSsoProvider(
				db,
				oidcInput({
					oidcConfig: {
						authorizationEndpoint: "https://idp.example.test/authorize",
						skipDiscovery: true,
					},
					providerId: "incomplete",
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
	});

	it("accepts publicly routable OIDC endpoints across multiple origins", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					authorization_endpoint: "https://accounts.example.com/authorize",
					issuer: "https://issuer.example.com",
					jwks_uri: "https://keys.example.net/jwks",
					token_endpoint: "https://tokens.example.org/token",
					userinfo_endpoint: "https://profile.example.dev/userinfo",
				}),
			),
		);

		const created = await createSsoProvider(
			db,
			oidcInput({
				issuer: "https://issuer.example.com",
				oidcConfig: { skipDiscovery: false },
			}),
			"owner",
			ORIGIN,
			REQUEST,
		);

		expect(created.oidcConfig).toMatchObject({
			authorizationEndpoint: "https://accounts.example.com/authorize",
			jwksEndpoint: "https://keys.example.net/jwks",
			tokenEndpoint: "https://tokens.example.org/token",
			userInfoEndpoint: "https://profile.example.dev/userinfo",
		});
	});

	it("rejects discovered OIDC endpoints on a private cross-origin host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					authorization_endpoint: "https://accounts.example.com/authorize",
					issuer: "https://issuer.example.com",
					jwks_uri: "https://keys.example.net/jwks",
					token_endpoint: "http://10.0.0.8/token",
				}),
			),
		);

		await expect(
			createSsoProvider(
				db,
				oidcInput({
					issuer: "https://issuer.example.com",
					oidcConfig: { skipDiscovery: false },
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoDiscoveryFailed");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
	});

	it("allows same-origin internal OIDC endpoints but rejects private cross-origin manual endpoints", async () => {
		await createSsoProvider(
			db,
			oidcInput({
				issuer: "http://10.0.0.8",
				oidcConfig: {
					authorizationEndpoint: "http://10.0.0.8/authorize",
					jwksEndpoint: "http://10.0.0.8/jwks",
					skipDiscovery: true,
					tokenEndpoint: "http://10.0.0.8/token",
				},
				providerId: "internal",
			}),
			"owner",
			ORIGIN,
			REQUEST,
		);

		await expect(
			createSsoProvider(
				db,
				oidcInput({
					oidcConfig: {
						authorizationEndpoint: "https://accounts.example.com/authorize",
						jwksEndpoint: "https://keys.example.net/jwks",
						skipDiscovery: true,
						tokenEndpoint: "http://192.168.1.10/token",
					},
					providerId: "private-cross-origin",
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		expect(
			await db
				.select()
				.from(ssoProvider)
				.where(eq(ssoProvider.providerId, "private-cross-origin")),
		).toHaveLength(0);
	});

	it("accepts valid SAML metadata or manual entryPoint plus entityID", async () => {
		await createSsoProvider(
			db,
			{
				displayName: "Metadata SAML",
				domain: "metadata.test",
				issuer: "https://shorty.test/saml/metadata",
				protocol: "saml",
				providerId: "metadata-saml",
				samlConfig: { idpMetadata: { metadata: validSamlMetadata } },
			},
			"owner",
			ORIGIN,
			REQUEST,
		);
		await createSsoProvider(
			db,
			{
				displayName: "Manual SAML",
				domain: "manual.test",
				issuer: "https://shorty.test/saml/manual",
				protocol: "saml",
				providerId: "manual-saml",
				samlConfig: {
					entryPoint: "https://idp.example.test/sso",
					idpMetadata: { entityID: "https://idp.example.test" },
				},
			},
			"owner",
			ORIGIN,
			REQUEST,
		);
		expect(await db.select().from(ssoProvider)).toHaveLength(2);
	});

	it("persists secure SAML attribute defaults and configurable mappings", async () => {
		const created = await createSsoProvider(
			db,
			{
				displayName: "Mapped SAML",
				domain: "mapped.test",
				issuer: "https://shorty.test/saml/mapped",
				protocol: "saml",
				providerId: "mapped-saml",
				samlConfig: { idpMetadata: { metadata: validSamlMetadata } },
			},
			"owner",
			ORIGIN,
			REQUEST,
		);
		expect(created.samlConfig?.mapping).toEqual(DEFAULT_SAML_ATTRIBUTE_MAPPING);

		const mapped = await updateSsoProvider(
			db,
			"mapped-saml",
			{
				samlConfig: {
					mapping: {
						email: "mail",
						emailVerified: "mail_confirmed",
						name: "full_name",
					},
				},
			},
			ORIGIN,
			REQUEST,
		);
		expect(mapped.samlConfig?.mapping).toEqual({
			email: "mail",
			emailVerified: "mail_confirmed",
			name: "full_name",
		});

		const renamed = await updateSsoProvider(
			db,
			"mapped-saml",
			{ displayName: "Renamed SAML" },
			ORIGIN,
			REQUEST,
		);
		expect(renamed.samlConfig?.mapping).toEqual(mapped.samlConfig?.mapping);
	});

	it("rejects invalid or incomplete SAML configuration", async () => {
		await expect(
			createSsoProvider(
				db,
				{
					displayName: "Invalid metadata",
					domain: "acme.test",
					issuer: "https://shorty.test/saml",
					protocol: "saml",
					providerId: "invalid-metadata",
					samlConfig: {
						idpMetadata: { metadata: "<not-valid-saml />" },
					},
				},
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoSamlMetadataInvalid");
		await expect(
			createSsoProvider(
				db,
				{
					displayName: "Incomplete manual",
					domain: "acme.test",
					issuer: "https://shorty.test/saml",
					protocol: "saml",
					providerId: "incomplete-manual",
					samlConfig: {
						entryPoint: "https://idp.example.test/sso",
						idpMetadata: {},
					},
				},
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
	});

	it("rejects protocol changes without deleting the current config", async () => {
		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		const [providerBefore] = await db.select().from(ssoProvider);

		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{
					protocol: "saml",
					samlConfig: {
						entryPoint: "https://idp.example.test/sso",
						idpMetadata: { entityID: "https://idp.example.test" },
					},
				},
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoProtocolImmutable");

		expect(await db.select().from(ssoProvider)).toEqual([providerBefore]);
	});

	it("keeps linked OIDC identities on the same issuer while allowing credential and endpoint rotation", async () => {
		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		const timestamp = new Date();
		await db.insert(account).values({
			accountId: "subject-1",
			createdAt: timestamp,
			id: "oidc-account",
			issuer: "local:workforce",
			providerId: "workforce",
			updatedAt: timestamp,
			userId: "owner",
		});

		const rotated = await updateSsoProvider(
			db,
			"workforce",
			{
				clientSecret: "rotated-secret",
				oidcConfig: {
					authorizationEndpoint: "https://idp.example.test/v2/authorize",
					jwksEndpoint: "https://idp.example.test/v2/jwks",
					skipDiscovery: true,
					tokenEndpoint: "https://idp.example.test/v2/token",
				},
			},
			ORIGIN,
			REQUEST,
		);
		expect(rotated.oidcConfig).toMatchObject({
			authorizationEndpoint: "https://idp.example.test/v2/authorize",
			clientSecret: "********",
			issuer: "https://idp.example.test",
		});
		const [encryptedProvider] = await db.select().from(ssoProvider);
		expect(encryptedProvider.oidcConfig).toContain("ssoenc:v1:");
		expect(encryptedProvider.oidcConfig).not.toContain("rotated-secret");

		const [providerBefore] = await db.select().from(ssoProvider);
		const [settingsBefore] = await db.select().from(ssoProviderSettings);
		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{ issuer: "https://other-idp.example.test" },
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoIdentityBoundaryImmutable");
		expect(await db.select().from(ssoProvider)).toEqual([providerBefore]);
		expect(await db.select().from(ssoProviderSettings)).toEqual([
			settingsBefore,
		]);
	});

	it("keeps linked SAML identities on the same IdP entity while allowing metadata rotation", async () => {
		await createSsoProvider(
			db,
			{
				displayName: "Metadata SAML",
				domain: "metadata.test",
				issuer: "https://shorty.test/saml/metadata",
				protocol: "saml",
				providerId: "metadata-saml",
				samlConfig: { idpMetadata: { metadata: validSamlMetadata } },
			},
			"owner",
			ORIGIN,
			REQUEST,
		);
		const timestamp = new Date();
		await db.insert(account).values({
			accountId: "subject-1",
			createdAt: timestamp,
			id: "saml-account",
			issuer: "local:metadata-saml",
			providerId: "metadata-saml",
			updatedAt: timestamp,
			userId: "owner",
		});

		const rotatedMetadata = validSamlMetadata.replace(
			"https://idp.example.test/sso",
			"https://idp.example.test/sso-rotated",
		);
		await expect(
			updateSsoProvider(
				db,
				"metadata-saml",
				{
					samlConfig: {
						idpMetadata: { metadata: rotatedMetadata },
					},
				},
				ORIGIN,
				REQUEST,
			),
		).resolves.toMatchObject({ providerId: "metadata-saml" });

		const changedEntityMetadata = rotatedMetadata.replace(
			'entityID="https://idp.example.test"',
			'entityID="https://other-idp.example.test"',
		);
		await expect(
			updateSsoProvider(
				db,
				"metadata-saml",
				{
					samlConfig: {
						idpMetadata: { metadata: changedEntityMetadata },
					},
				},
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoIdentityBoundaryImmutable");
	});

	it("rolls back account and provider deletion together when the parent delete fails", async () => {
		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		const timestamp = new Date();
		await db.insert(account).values({
			accountId: "subject-1",
			createdAt: timestamp,
			id: "linked-account",
			issuer: "local:workforce",
			providerId: "workforce",
			updatedAt: timestamp,
			userId: "owner",
		});
		const accountsBefore = await db.select().from(account);
		const providersBefore = await db.select().from(ssoProvider);
		const settingsBefore = await db.select().from(ssoProviderSettings);
		await database
			.prepare(`
				CREATE TRIGGER fail_sso_provider_delete
				BEFORE DELETE ON ssoProvider
				BEGIN
					SELECT RAISE(FAIL, 'injected provider delete failure');
				END
			`)
			.run();

		await expect(deleteSsoProvider(db, "workforce")).rejects.toThrow(
			"injected provider delete failure",
		);
		expect(await db.select().from(account)).toEqual(accountsBefore);
		expect(await db.select().from(ssoProvider)).toEqual(providersBefore);
		expect(await db.select().from(ssoProviderSettings)).toEqual(settingsBefore);
	});

	it("deletes linked accounts and permits an explicit provider relink", async () => {
		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		const timestamp = new Date();
		await db.insert(account).values({
			accountId: "subject-1",
			createdAt: timestamp,
			id: "stale-account",
			issuer: "local:workforce",
			providerId: "workforce",
			updatedAt: timestamp,
			userId: "owner",
		});

		await deleteSsoProvider(db, "workforce");
		expect(await db.select().from(account)).toHaveLength(0);
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
		expect(await db.select().from(ssoProviderSettings)).toHaveLength(0);

		await createSsoProvider(
			db,
			oidcInput({ issuer: "https://replacement-idp.example.test" }),
			"owner",
			ORIGIN,
			REQUEST,
		);
		await db.insert(account).values({
			accountId: "subject-1",
			createdAt: timestamp,
			id: "replacement-account",
			issuer: "local:workforce",
			providerId: "workforce",
			updatedAt: timestamp,
			userId: "owner",
		});
		expect(await db.select({ id: account.id }).from(account)).toEqual([
			{ id: "replacement-account" },
		]);
	});

	it("rolls back both provider rows when an atomic settings update fails", async () => {
		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		const [providerBefore] = await db.select().from(ssoProvider);
		const [settingsBefore] = await db.select().from(ssoProviderSettings);
		await database
			.prepare(`
				CREATE TRIGGER fail_sso_settings_update
				BEFORE UPDATE ON sso_provider_settings
				BEGIN
					SELECT RAISE(FAIL, 'injected settings failure');
				END
			`)
			.run();

		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{
					displayName: "Should not persist",
					domain: "changed.test",
				},
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("injected settings failure");

		expect(
			await db
				.select()
				.from(ssoProvider)
				.where(eq(ssoProvider.providerId, "workforce")),
		).toEqual([providerBefore]);
		expect(
			await db
				.select()
				.from(ssoProviderSettings)
				.where(eq(ssoProviderSettings.providerId, "workforce")),
		).toEqual([settingsBefore]);
	});

	it("does not leave an orphan provider when atomic settings creation fails", async () => {
		await database
			.prepare(`
				CREATE TRIGGER fail_sso_settings_insert
				BEFORE INSERT ON sso_provider_settings
				BEGIN
					SELECT RAISE(FAIL, 'injected settings insert failure');
				END
			`)
			.run();
		await database
			.prepare(`
				CREATE TRIGGER fail_provider_compensation_delete
				BEFORE DELETE ON ssoProvider
				BEGIN
					SELECT RAISE(FAIL, 'compensation delete must not run');
				END
			`)
			.run();

		await expect(
			createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST),
		).rejects.toThrow("injected settings insert failure");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
		expect(await db.select().from(ssoProviderSettings)).toHaveLength(0);
	});

	it("returns deterministic missing and concurrent-update conflicts without mixed state", async () => {
		await expect(
			updateSsoProvider(
				db,
				"missing",
				{ displayName: "Missing" },
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoProviderMissing");

		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		await updateSsoProvider(
			db,
			"workforce",
			{ displayName: "Sequential one", domain: "sequential-one.test" },
			ORIGIN,
			REQUEST,
		);
		await updateSsoProvider(
			db,
			"workforce",
			{ displayName: "Sequential two", domain: "sequential-two.test" },
			ORIGIN,
			REQUEST,
		);
		const [sequentialProvider] = await db.select().from(ssoProvider);
		const [sequentialSettings] = await db.select().from(ssoProviderSettings);
		expect(
			`${sequentialProvider.domain}:${sequentialSettings.displayName}`,
		).toBe("sequential-two.test:Sequential two");

		const outcomes = await Promise.allSettled([
			updateSsoProvider(
				db,
				"workforce",
				{ displayName: "Concurrent alpha", domain: "alpha.test" },
				ORIGIN,
				REQUEST,
			),
			updateSsoProvider(
				db,
				"workforce",
				{ displayName: "Concurrent beta", domain: "beta.test" },
				ORIGIN,
				REQUEST,
			),
		]);
		expect(
			outcomes.filter(({ status }) => status === "fulfilled"),
		).toHaveLength(1);
		const rejected = outcomes.find(({ status }) => status === "rejected");
		expect(rejected?.status).toBe("rejected");
		if (rejected?.status !== "rejected") {
			throw new Error("Expected one concurrent update to be rejected");
		}
		expect(rejected.reason).toMatchObject({
			message: "errors.ssoProviderConflict",
		});

		const [concurrentProvider] = await db.select().from(ssoProvider);
		const [concurrentSettings] = await db.select().from(ssoProviderSettings);
		expect([
			"alpha.test:Concurrent alpha",
			"beta.test:Concurrent beta",
		]).toContain(
			`${concurrentProvider.domain}:${concurrentSettings.displayName}`,
		);
	});

	it("accepts references to a newly added custom role", async () => {
		const timestamp = new Date();
		await db.insert(roles).values({
			createdAt: timestamp,
			description: null,
			id: "engineer",
			isSystem: false,
			name: "Engineer",
			permissions: "[]",
			updatedAt: timestamp,
		});

		const provider = await createSsoProvider(
			db,
			oidcInput({
				defaultRoleId: "engineer",
				groupRoleMappings: [{ group: "eng", roleId: "engineer" }],
			}),
			"owner",
			ORIGIN,
			REQUEST,
		);

		expect(provider.defaultRoleId).toBe("engineer");
		expect(provider.groupRoleMappings).toEqual([
			{ group: "eng", roleId: "engineer" },
		]);
	});
});
