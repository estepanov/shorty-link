import { describe, expect, it } from "vitest";

import {
	isOidcDiscoveryEndpointAllowed,
	isOidcEndpointAllowed,
} from "../src/server/auth/oidc-endpoint-security";

describe("OIDC endpoint security", () => {
	const issuerOrigin = "https://issuer.example.com";

	it("allows same-origin internal endpoints and public cross-origin endpoints", () => {
		expect(
			isOidcEndpointAllowed("http://10.0.0.8/token", "http://10.0.0.8"),
		).toBe(true);
		expect(
			isOidcEndpointAllowed("https://tokens.example.net/token", issuerOrigin),
		).toBe(true);
	});

	it.each([
		"http://10.0.0.8/token",
		"http://169.254.169.254/token",
		"http://192.0.2.10/token",
		"http://metadata.google.internal/token",
		"ftp://tokens.example.net/token",
	])("rejects an unsafe cross-origin endpoint: %s", (endpoint) => {
		expect(isOidcEndpointAllowed(endpoint, issuerOrigin)).toBe(false);
	});

	it("keeps discovery on the configured issuer origin", () => {
		expect(
			isOidcDiscoveryEndpointAllowed(
				"https://issuer.example.com/.well-known/openid-configuration",
				issuerOrigin,
			),
		).toBe(true);
		expect(
			isOidcDiscoveryEndpointAllowed(
				"https://discovery.example.net/.well-known/openid-configuration",
				issuerOrigin,
			),
		).toBe(false);
	});
});
