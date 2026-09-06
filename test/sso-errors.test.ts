import { describe, expect, it } from "vitest";

import { mapSsoErrorCode, parseSsoCallbackError } from "@/lib/sso-errors";

describe("SSO error mapping", () => {
	it("preserves known localized Shorty SSO errors", () => {
		expect(mapSsoErrorCode("errors.ssoNotProvisioned")).toBe(
			"errors.ssoNotProvisioned",
		);
	});

	it("maps known cancellation errors to the localized cancellation message", () => {
		expect(mapSsoErrorCode("access_denied")).toBe("errors.ssoCancelled");
		expect(mapSsoErrorCode("USER_CANCELLED")).toBe("errors.ssoCancelled");
	});

	it("maps provider and unknown errors to the generic localized message", () => {
		expect(mapSsoErrorCode("invalid_state")).toBe("errors.unknown");
		expect(mapSsoErrorCode("attacker-controlled description")).toBe(
			"errors.unknown",
		);
	});

	it("ignores callback descriptions and returns no error without an error code", () => {
		expect(
			parseSsoCallbackError({
				error: "errors.ssoEmailUnverified",
				error_description: "<script>arbitrary provider message</script>",
			}),
		).toBe("errors.ssoEmailUnverified");
		expect(
			parseSsoCallbackError({
				error_description: "arbitrary provider message",
			}),
		).toBeNull();
		expect(parseSsoCallbackError({ error: ["invalid_state"] })).toBe(
			"errors.unknown",
		);
	});
});
