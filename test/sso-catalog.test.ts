import { describe, expect, it } from "vitest";

import type { SsoPublicCatalog } from "../src/lib/sso-catalog";
import {
	isSsoEnforcedForEmail,
	matchingSsoProvider,
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
	it("matches the first provider whose domain includes the email", () => {
		expect(matchingSsoProvider(catalog, "ada@acme.com")?.providerId).toBe(
			"okta",
		);
		expect(matchingSsoProvider(catalog, "ada@other.com")).toBeNull();
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
