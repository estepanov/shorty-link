import { describe, expect, it } from "vitest";

import { resolveApiKeyFromHeaders } from "../src/server/auth/api-key-headers";

describe("resolveApiKeyFromHeaders", () => {
	it("reads x-api-key", () => {
		const headers = new Headers({ "x-api-key": "sl_admin_key" });
		expect(resolveApiKeyFromHeaders(headers)).toBe("sl_admin_key");
	});

	it("reads Authorization Bearer API keys", () => {
		const headers = new Headers({
			authorization: "Bearer sl_admin_key",
		});
		expect(resolveApiKeyFromHeaders(headers)).toBe("sl_admin_key");
	});

	it("ignores MCP OAuth bearer tokens", () => {
		const headers = new Headers({
			authorization: "Bearer AbCdEfGhIjKlMnOpQrStUvWxYz012345",
		});
		expect(resolveApiKeyFromHeaders(headers)).toBeNull();
	});

	it("ignores missing credentials", () => {
		expect(resolveApiKeyFromHeaders(new Headers())).toBeNull();
	});
});
