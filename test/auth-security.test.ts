import { describe, expect, it } from "vitest";

import {
	hostMatchesPattern,
	isTrustedHostname,
	resolveTrustedRequestOrigin,
	splitTrustedHosts,
} from "../src/server/auth/security";

describe("auth security helpers", () => {
	it("normalizes configured trusted hosts", () => {
		expect(
			splitTrustedHosts(
				" links.example.com,https://admin.example.com/path,*.workers.dev,, ",
			),
		).toEqual(["links.example.com", "admin.example.com", "*.workers.dev"]);
	});

	it("supports exact and wildcard host matching", () => {
		expect(hostMatchesPattern("links.example.com", "links.example.com")).toBe(
			true,
		);
		expect(hostMatchesPattern("tenant.workers.dev", "*.workers.dev")).toBe(
			true,
		);
		expect(hostMatchesPattern("workers.dev", "*.workers.dev")).toBe(false);
		expect(hostMatchesPattern("evil.example.com", "links.example.com")).toBe(
			false,
		);
	});

	it("accepts only trusted request origins", () => {
		const allowedHosts = ["links.example.com", "*.workers.dev"];

		expect(
			isTrustedHostname("links.example.com", {
				allowedHosts,
				fallbackOrigin: "https://admin.example.com",
			}),
		).toBe(true);
		expect(
			isTrustedHostname("tenant.workers.dev", {
				allowedHosts,
				fallbackOrigin: "https://admin.example.com",
			}),
		).toBe(true);
		expect(
			isTrustedHostname("admin.example.com", {
				allowedHosts,
				fallbackOrigin: "https://admin.example.com",
			}),
		).toBe(true);
		expect(
			isTrustedHostname("attacker.example.net", {
				allowedHosts,
				fallbackOrigin: "https://admin.example.com",
			}),
		).toBe(false);

		expect(
			resolveTrustedRequestOrigin(
				new Request("https://links.example.com/api/auth/session"),
				{
					allowedHosts,
					fallbackOrigin: "https://admin.example.com",
				},
			),
		).toBe("https://links.example.com");
		expect(
			resolveTrustedRequestOrigin(
				new Request("https://attacker.example.net/api/auth/session"),
				{
					allowedHosts,
					fallbackOrigin: "https://admin.example.com",
				},
			),
		).toBeNull();
	});
});
