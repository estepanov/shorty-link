import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	account,
	roles,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../src/server/db/schema";
import { readConfigJson } from "../src/server/services/sso-provider-config";
import {
	createSsoProvider,
	deleteSsoProvider,
	updateSsoProvider,
} from "../src/server/services/sso-providers";
import { deleteUser } from "../src/server/services/users";
import {
	createSsoProviderD1Fixture,
	SSO_TEST_ORIGIN as ORIGIN,
	oidcProviderInput as oidcInput,
	SSO_TEST_REQUEST as REQUEST,
} from "./sso-provider-d1-fixture";

describe("D1 SSO provider persistence", () => {
	let dispose: (() => Promise<void>) | null = null;
	let database: D1Database;
	let db: Awaited<ReturnType<typeof createSsoProviderD1Fixture>>["db"];

	beforeEach(async () => {
		const fixture = await createSsoProviderD1Fixture();
		database = fixture.database;
		db = fixture.db;
		dispose = fixture.dispose;
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await dispose?.();
		dispose = null;
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
			{ displayName: "Renamed workforce", protocol: "oidc" },
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
					protocol: "oidc",
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
				{ defaultRoleId: null, jitEnabled: true, protocol: "oidc" },
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

		await expect(
			updateSsoProvider(
				db,
				"workforce",
				{ clientSecret: "", protocol: "oidc" },
				ORIGIN,
				REQUEST,
			),
		).resolves.toMatchObject({ hasClientSecret: true });
		const [blankSecretProvider] = await db.select().from(ssoProvider);
		expect(
			JSON.parse(
				(await readConfigJson(blankSecretProvider.oidcConfig, REQUEST)) ?? "{}",
			).clientSecret,
		).toBe("client-secret");

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
				protocol: "oidc",
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
				{ issuer: "https://other-idp.example.test", protocol: "oidc" },
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoIdentityBoundaryImmutable");
		expect(await db.select().from(ssoProvider)).toEqual([providerBefore]);
		expect(await db.select().from(ssoProviderSettings)).toEqual([
			settingsBefore,
		]);
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

	it("keeps global SSO configuration when its registration actor is deleted", async () => {
		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: "manager@acme.test",
			emailVerified: true,
			id: "manager",
			image: null,
			isActive: true,
			locale: "en",
			name: "Manager",
			roleId: SYSTEM_ROLE_ADMIN,
			updatedAt: timestamp,
		});
		await createSsoProvider(db, oidcInput(), "manager", ORIGIN, REQUEST);

		await expect(deleteUser(db, "manager")).resolves.toBeUndefined();
		expect(
			await db
				.select({
					providerId: ssoProvider.providerId,
					userId: ssoProvider.userId,
				})
				.from(ssoProvider),
		).toEqual([{ providerId: "workforce", userId: "manager" }]);
		expect(
			await db.select({ id: user.id }).from(user).where(eq(user.id, "manager")),
		).toEqual([]);
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
					protocol: "oidc",
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
				{ displayName: "Missing", protocol: "oidc" },
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoProviderMissing");

		await createSsoProvider(db, oidcInput(), "owner", ORIGIN, REQUEST);
		await updateSsoProvider(
			db,
			"workforce",
			{
				displayName: "Sequential one",
				domain: "sequential-one.test",
				protocol: "oidc",
			},
			ORIGIN,
			REQUEST,
		);
		await updateSsoProvider(
			db,
			"workforce",
			{
				displayName: "Sequential two",
				domain: "sequential-two.test",
				protocol: "oidc",
			},
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
				{
					displayName: "Concurrent alpha",
					domain: "alpha.test",
					protocol: "oidc",
				},
				ORIGIN,
				REQUEST,
			),
			updateSsoProvider(
				db,
				"workforce",
				{
					displayName: "Concurrent beta",
					domain: "beta.test",
					protocol: "oidc",
				},
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
