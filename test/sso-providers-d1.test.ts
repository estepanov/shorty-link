import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
	DEFAULT_SAML_ATTRIBUTE_MAPPING,
	type SsoProviderWrite,
} from "../src/lib/sso-types";
import {
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
					groupRoleMappings: [{ group: "owners", roleId: SYSTEM_ROLE_OWNER }],
				}),
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoOwnerRoleForbidden");
		expect(await db.select().from(ssoProvider)).toHaveLength(0);
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

	it("restores the exact provider row when settings persistence fails", async () => {
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
		).rejects.toThrow("Failed query");

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
