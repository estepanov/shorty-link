import { describe, expect, it } from "vitest";

import type { SsoPublicCatalog } from "../src/lib/sso-catalog";
import {
	isSsoEnforcedForEmail,
	matchingSsoProviders,
	visibleSsoProviders,
} from "../src/lib/sso-catalog";

const catalog: SsoPublicCatalog = {
	hasEnforcedDomain: true,
	providers: [
		{
			displayName: "Acme Okta",
			domains: ["acme.com"],
			enforceSso: true,
			protocol: "oidc",
			providerId: "okta",
		},
		{
			displayName: "Partner SAML",
			domains: ["partner.com"],
			enforceSso: false,
			protocol: "saml",
			providerId: "partner",
		},
	],
};

describe("sso catalog", () => {
	it("returns every matching provider in deterministic order", () => {
		const overlappingCatalog: SsoPublicCatalog = {
			hasEnforcedDomain: true,
			providers: [
				...catalog.providers,
				{
					displayName: "Acme Backup",
					domains: ["acme.com"],
					enforceSso: true,
					protocol: "saml",
					providerId: "backup",
				},
			],
		};
		expect(
			matchingSsoProviders(overlappingCatalog, "ada@acme.com").map(
				(provider) => provider.providerId,
			),
		).toEqual(["backup", "okta"]);
		expect(matchingSsoProviders(catalog, "ada@other.com")).toEqual([]);
	});

	it("hides enforced providers until the email domain is known", () => {
		expect(
			visibleSsoProviders(catalog, "").map((provider) => provider.providerId),
		).toEqual(["partner"]);
		expect(
			visibleSsoProviders(catalog, "ada@acme.com").map(
				(provider) => provider.providerId,
			),
		).toEqual(["okta"]);
		expect(
			visibleSsoProviders(catalog, "ada@partner.com").map(
				(provider) => provider.providerId,
			),
		).toEqual(["okta", "partner"]);
	});

	it("treats a missing enabled flag as enabled for enforcement", () => {
		expect(
			isSsoEnforcedForEmail("ada@acme.com", [
				{ domains: ["acme.com"], enforceSso: true },
			]),
		).toBe(true);
	});
});
