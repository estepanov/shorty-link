import { describe, expect, it } from "vitest";

import {
	emptySsoFormValues,
	ssoProviderToFormValues,
	toSsoProviderCreate,
	toSsoProviderPatch,
} from "../src/components/sso-provider-form-codec";
import type { SsoProviderRead } from "../src/lib/sso-types";

describe("SSO provider form codec", () => {
	it("builds protocol-specific OIDC create payloads", () => {
		const payload = toSsoProviderCreate({
			...emptySsoFormValues,
			authorizationEndpoint: "https://idp.example.test/authorize",
			clientId: "client-id",
			clientSecret: "client-secret",
			displayName: "Workforce",
			domain: "acme.test",
			issuer: "https://idp.example.test",
			jwksEndpoint: "https://idp.example.test/jwks",
			providerId: "workforce",
			skipDiscovery: true,
			tokenEndpoint: "https://idp.example.test/token",
		});

		expect(payload).toEqual(
			expect.objectContaining({
				clientId: "client-id",
				clientSecret: "client-secret",
				oidcConfig: expect.objectContaining({
					skipDiscovery: true,
				}),
				protocol: "oidc",
			}),
		);
		expect(payload).not.toHaveProperty("samlConfig");
	});

	it("uses replacement semantics when switching SAML metadata to manual fields", () => {
		const payload = toSsoProviderPatch(
			{
				...emptySsoFormValues,
				cert: "signing-certificate",
				displayName: "Workforce SAML",
				domain: "acme.test",
				entryPoint: "https://idp.example.test/sso",
				idpEntityId: "https://idp.example.test",
				issuer: "https://shorty.example.test/saml",
				protocol: "saml",
				providerId: "workforce",
			},
			"saml",
		);

		expect(payload).toMatchObject({
			protocol: "saml",
			samlConfig: {
				cert: "signing-certificate",
				entryPoint: "https://idp.example.test/sso",
				idpMetadata: { entityID: "https://idp.example.test" },
			},
		});
		if (payload.protocol !== "saml") {
			throw new Error("Expected a SAML patch");
		}
		expect(payload.samlConfig?.idpMetadata).not.toHaveProperty("metadata");
	});

	it("round-trips every editable protocol field from the admin DTO", () => {
		const provider: SsoProviderRead = {
			acsUrl: "https://shorty.test/acs",
			allowIdpInitiated: true,
			callbackUrl: "https://shorty.test/callback",
			defaultRoleId: null,
			displayName: "Workforce",
			domains: ["acme.test"],
			enabled: true,
			enforceSso: false,
			groupClaim: "groups",
			groupRoleMappings: [],
			hasClientSecret: true,
			issuer: "https://idp.example.test",
			jitEnabled: false,
			oidcConfig: {
				authorizationEndpoint: "https://idp.example.test/authorize",
				clientId: "client-id",
				discoveryEndpoint: "https://idp.example.test/discovery",
				jwksEndpoint: "https://idp.example.test/jwks",
				skipDiscovery: true,
				tokenEndpoint: "https://idp.example.test/token",
				userInfoEndpoint: "https://idp.example.test/userinfo",
			},
			protocol: "oidc",
			providerId: "workforce",
			samlConfig: null,
			spMetadataUrl: "https://shorty.test/metadata",
		};

		expect(ssoProviderToFormValues(provider)).toMatchObject({
			authorizationEndpoint: "https://idp.example.test/authorize",
			clientId: "client-id",
			discoveryEndpoint: "https://idp.example.test/discovery",
			jwksEndpoint: "https://idp.example.test/jwks",
			skipDiscovery: true,
			tokenEndpoint: "https://idp.example.test/token",
			userInfoEndpoint: "https://idp.example.test/userinfo",
		});
	});
});
