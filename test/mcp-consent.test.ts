import { mkdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
	oauthApplication,
	SYSTEM_ROLE_OWNER,
	schema,
	user,
	verification,
} from "../src/server/db/schema";
import { getMcpConsentPrompt } from "../src/server/services/mcp-grants";
import { applyD1Migrations } from "./apply-d1-migrations";

describe("mcp consent prompt", () => {
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
			clientId: "real-client",
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

	it("loads client name and scopes from the consent code, not a spoofed client id", async () => {
		await db.insert(verification).values({
			id: "ver-1",
			identifier: "consent-code-1",
			value: JSON.stringify({
				clientId: "real-client",
				scope: ["openid", "profile"],
				userId: "owner-1",
			}),
			expiresAt: new Date(Date.now() + 60_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await expect(
			getMcpConsentPrompt(db, "owner-1", "consent-code-1"),
		).resolves.toEqual({
			clientId: "real-client",
			clientName: "Claude",
			scopes: ["openid", "profile"],
		});
	});

	it("rejects another user's consent code", async () => {
		await db.insert(verification).values({
			id: "ver-2",
			identifier: "consent-code-2",
			value: JSON.stringify({
				clientId: "real-client",
				scope: ["openid"],
				userId: "someone-else",
			}),
			expiresAt: new Date(Date.now() + 60_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await expect(
			getMcpConsentPrompt(db, "owner-1", "consent-code-2"),
		).rejects.toThrow("errors.mcpConsentMissing");
	});
});
