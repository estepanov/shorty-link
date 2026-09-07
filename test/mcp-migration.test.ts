import { mkdirSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { applyD1Migrations } from "./apply-d1-migrations";

describe("Better Auth 1.7 MCP migration", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let database: D1Database;

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
		await applyD1Migrations(database, {
			through: "0011_hosted_mcp.sql",
		});
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("preserves registered clients and revokes incompatible legacy tokens", async () => {
		await database
			.prepare(
				`INSERT INTO oauthApplication
				 (id, name, clientId, clientSecret, redirectUrls, type, disabled, createdAt, updatedAt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"legacy-client",
				"Claude",
				"claude-client",
				"secret",
				"https://claude.ai/callback",
				"web",
				false,
				1_700_000_000,
				1_700_000_000,
			)
			.run();
		await database
			.prepare(
				`INSERT INTO oauthAccessToken
				 (id, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, clientId, userId, scopes, createdAt, updatedAt)
				 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
			)
			.bind(
				"legacy-token",
				"access-token",
				"refresh-token",
				1_900_000_000,
				1_900_000_000,
				"claude-client",
				"openid profile",
				1_700_000_000,
				1_700_000_000,
			)
			.run();

		await applyD1Migrations(database, {
			from: "0012_better_auth_1_7_mcp.sql",
			through: "0012_better_auth_1_7_mcp.sql",
		});

		const client = await database
			.prepare(
				`SELECT clientId, name, redirectUris, applicationType,
				        tokenEndpointAuthMethod
				 FROM oauthClient`,
			)
			.first<{
				applicationType: string;
				clientId: string;
				name: string;
				redirectUris: string;
				tokenEndpointAuthMethod: string;
			}>();
		expect(client).toEqual({
			applicationType: "web",
			clientId: "claude-client",
			name: "Claude",
			redirectUris: '["https://claude.ai/callback"]',
			tokenEndpointAuthMethod: "client_secret_basic",
		});

		const tokenCount = await database
			.prepare("SELECT count(*) AS total FROM oauthAccessToken")
			.first<{ total: number }>();
		expect(tokenCount?.total).toBe(0);
	});
});
