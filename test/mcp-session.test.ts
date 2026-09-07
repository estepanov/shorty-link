import { mkdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import {
	oauthAccessToken,
	oauthApplication,
	SYSTEM_ROLE_OWNER,
	schema,
	user,
} from "../src/server/db/schema";
import { getMcpBearerSession } from "../src/server/mcp/session";
import { applyD1Migrations } from "./apply-d1-migrations";

describe("mcp bearer session", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(async () => {
		mkdirSync("/tmp/wrangler-logs", { recursive: true });
		process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
		process.env.WRANGLER_LOG = "error";

		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		const database = (proxy.env as { DB: D1Database }).DB;
		await applyD1Migrations(database);
		db = drizzle(database, { schema });

		const ts = new Date();
		await db.insert(user).values({
			id: "owner-1",
			name: "owner-1",
			email: "owner-1@example.com",
			emailVerified: true,
			image: null,
			roleId: SYSTEM_ROLE_OWNER,
			locale: "en",
			isActive: true,
			mcpAccessEnabled: true,
			createdAt: ts,
			updatedAt: ts,
		});
		await db.insert(oauthApplication).values({
			id: "app-1",
			name: "Claude",
			clientId: "claude",
			clientSecret: "secret",
			redirectUrls: "https://claude.ai/callback",
			type: "web",
			disabled: false,
			createdAt: ts,
			updatedAt: ts,
		});
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("resolves a 32-character MCP access token", async () => {
		const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
		const ts = new Date();
		await db.insert(oauthAccessToken).values({
			id: "tok-1",
			accessToken: token,
			refreshToken: "refresh-token-value-32-chars-xxxx",
			accessTokenExpiresAt: new Date(Date.now() + 60_000),
			refreshTokenExpiresAt: new Date(Date.now() + 120_000),
			clientId: "claude",
			userId: "owner-1",
			scopes: "openid profile",
			createdAt: ts,
			updatedAt: ts,
		});

		const session = await getMcpBearerSession(
			db,
			new Request("http://localhost/mcp", {
				headers: { authorization: `Bearer ${token}` },
			}),
		);
		expect(session).toEqual({
			userId: "owner-1",
		});
	});

	it("rejects expired and missing tokens", async () => {
		const token = "expiredMcpAccessTokenValue32chars";
		const ts = new Date();
		await db.insert(oauthAccessToken).values({
			id: "tok-expired",
			accessToken: token,
			refreshToken: "refresh-expired-token-32-charsxx",
			accessTokenExpiresAt: new Date(Date.now() - 1_000),
			refreshTokenExpiresAt: new Date(Date.now() + 120_000),
			clientId: "claude",
			userId: "owner-1",
			scopes: "openid profile",
			createdAt: ts,
			updatedAt: ts,
		});

		await expect(
			getMcpBearerSession(
				db,
				new Request("http://localhost/mcp", {
					headers: { authorization: `Bearer ${token}` },
				}),
			),
		).resolves.toBeNull();
		await expect(
			getMcpBearerSession(db, new Request("http://localhost/mcp")),
		).resolves.toBeNull();
	});
});
