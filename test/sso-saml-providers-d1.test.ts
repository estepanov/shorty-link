import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SAML_ATTRIBUTE_MAPPING } from "../src/lib/sso-types";
import { account, ssoProvider } from "../src/server/db/schema";
import {
	createSsoProvider,
	updateSsoProvider,
} from "../src/server/services/sso-providers";
import {
	createSsoProviderD1Fixture,
	SSO_TEST_ORIGIN as ORIGIN,
	SSO_TEST_REQUEST as REQUEST,
	VALID_SAML_METADATA as validSamlMetadata,
} from "./sso-provider-d1-fixture";

describe("D1 SAML provider configuration", () => {
	let dispose: (() => Promise<void>) | null = null;
	let db: Awaited<ReturnType<typeof createSsoProviderD1Fixture>>["db"];

	beforeEach(async () => {
		const fixture = await createSsoProviderD1Fixture();
		db = fixture.db;
		dispose = fixture.dispose;
	});

	afterEach(async () => {
		await dispose?.();
		dispose = null;
	});

	it("accepts valid metadata or a verifiable manual configuration", async () => {
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
					cert: "manual-idp-signing-certificate",
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

	it("rejects manual configuration without a signing certificate", async () => {
		await expect(
			createSsoProvider(
				db,
				{
					displayName: "Unsigned Manual SAML",
					domain: "manual.test",
					issuer: "https://shorty.test/saml/manual",
					protocol: "saml",
					providerId: "unsigned-manual-saml",
					samlConfig: {
						entryPoint: "https://idp.example.test/sso",
						idpMetadata: { entityID: "https://idp.example.test" },
					},
				},
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
	});

	it("persists secure attribute defaults and configurable mappings", async () => {
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
				protocol: "saml",
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
			{ displayName: "Renamed SAML", protocol: "saml" },
			ORIGIN,
			REQUEST,
		);
		expect(renamed.samlConfig?.mapping).toEqual(mapped.samlConfig?.mapping);
	});

	it("replaces metadata mode without retaining stale metadata", async () => {
		await createSsoProvider(
			db,
			{
				displayName: "Replaceable SAML",
				domain: "replace.test",
				issuer: "https://shorty.test/saml/replace",
				protocol: "saml",
				providerId: "replaceable-saml",
				samlConfig: { idpMetadata: { metadata: validSamlMetadata } },
			},
			"owner",
			ORIGIN,
			REQUEST,
		);

		const updated = await updateSsoProvider(
			db,
			"replaceable-saml",
			{
				protocol: "saml",
				samlConfig: {
					cert: "replacement-signing-certificate",
					entryPoint: "https://manual-idp.example.test/sso",
					idpMetadata: { entityID: "https://manual-idp.example.test" },
				},
			},
			ORIGIN,
			REQUEST,
		);

		expect(updated.samlConfig).toMatchObject({
			entryPoint: "https://manual-idp.example.test/sso",
			idpMetadata: { entityID: "https://manual-idp.example.test" },
		});
		expect(updated.samlConfig?.idpMetadata?.metadata).toBeUndefined();
	});

	it("rejects invalid or incomplete configuration", async () => {
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
						idpMetadata: { entityID: "https://idp.example.test" },
					},
				},
				"owner",
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoConfigurationInvalid");
	});

	it("locks linked identities to the same IdP entity during metadata rotation", async () => {
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
					protocol: "saml",
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
					protocol: "saml",
					samlConfig: {
						idpMetadata: { metadata: changedEntityMetadata },
					},
				},
				ORIGIN,
				REQUEST,
			),
		).rejects.toThrow("errors.ssoIdentityBoundaryImmutable");
	});
});
