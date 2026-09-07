import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { ALL_PERMISSIONS } from "../src/lib/permissions";
import {
	oauthAccessToken,
	oauthApplication,
	oauthConsent,
	roles,
	SYSTEM_ROLE_OWNER,
	schema,
	user,
} from "../src/server/db/schema";
import {
	listMcpGrants,
	revokeMcpGrant,
} from "../src/server/services/mcp-grants";
import {
	getMcpSettings,
	getUserMcpAccess,
	setMcpServerEnabled,
} from "../src/server/services/mcp-settings";
import { getRoleById } from "../src/server/services/roles";
import { updateUser } from "../src/server/services/users";
import { applyD1Migrations } from "./apply-d1-migrations";

async function seedUser(
	db: ReturnType<typeof drizzle<typeof schema>>,
	id: string,
) {
	const ts = new Date();
	await db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
		emailVerified: true,
		image: null,
		roleId: SYSTEM_ROLE_OWNER,
		locale: "en",
		isActive: true,
		mcpAccessEnabled: true,
		createdAt: ts,
		updatedAt: ts,
	});
}

async function seedGrant(
	db: ReturnType<typeof drizzle<typeof schema>>,
	input: { userId: string; clientId: string; grantId: string },
) {
	const ts = new Date();
	await db.insert(oauthApplication).values({
		id: `app-${input.clientId}`,
		name: "Claude",
		clientId: input.clientId,
		clientSecret: "secret",
		redirectUrls: "https://claude.ai/callback",
		type: "web",
		disabled: false,
		createdAt: ts,
		updatedAt: ts,
	});
	await db.insert(oauthConsent).values({
		id: input.grantId,
		clientId: input.clientId,
		userId: input.userId,
		scopes: "openid profile",
		consentGiven: true,
		createdAt: ts,
		updatedAt: ts,
	});
	await db.insert(oauthAccessToken).values({
		id: `tok-${input.grantId}`,
		accessToken: `access-${input.grantId}`,
		refreshToken: `refresh-${input.grantId}`,
		accessTokenExpiresAt: new Date(Date.now() + 60_000),
		refreshTokenExpiresAt: new Date(Date.now() + 120_000),
		clientId: input.clientId,
		userId: input.userId,
		scopes: "openid profile",
		createdAt: ts,
		updatedAt: ts,
	});
}

describe("mcp access controls", () => {
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
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("defaults the MCP server to disabled", async () => {
		await expect(getMcpSettings(db)).resolves.toEqual({ serverEnabled: false });
	});

	it("enables and disables the MCP server", async () => {
		await setMcpServerEnabled(db, true);
		await expect(getMcpSettings(db)).resolves.toEqual({ serverEnabled: true });
		await setMcpServerEnabled(db, false);
		await expect(getMcpSettings(db)).resolves.toEqual({ serverEnabled: false });
	});

	it("grants system roles the mcp.manage permission", async () => {
		const owner = await getRoleById(db, SYSTEM_ROLE_OWNER);
		expect(owner).not.toBeNull();
		expect(owner?.permissions).toContain("mcp.manage");
		for (const permission of ALL_PERMISSIONS) {
			expect(owner?.permissions).toContain(permission);
		}
		const [admin] = await db
			.select({ permissions: roles.permissions })
			.from(roles)
			.where(eq(roles.id, "system_admin"));
		expect(admin?.permissions).toContain("mcp.manage");
	});

	it("revokes tokens when individual MCP access is disabled", async () => {
		await seedUser(db, "owner-1");
		await seedGrant(db, {
			userId: "owner-1",
			clientId: "claude",
			grantId: "grant-1",
		});

		await updateUser(db, "owner-1", { mcpAccessEnabled: false });
		await expect(getUserMcpAccess(db, "owner-1")).resolves.toEqual({
			exists: true,
			allowed: false,
		});
		await expect(listMcpGrants(db, "owner-1")).resolves.toEqual([]);
	});

	it("lets a user revoke a single MCP grant", async () => {
		await seedUser(db, "owner-1");
		await seedGrant(db, {
			userId: "owner-1",
			clientId: "chatgpt",
			grantId: "grant-2",
		});

		const grants = await listMcpGrants(db, "owner-1");
		expect(grants).toHaveLength(1);
		expect(grants[0]?.clientName).toBe("Claude");

		await revokeMcpGrant(db, "owner-1", "grant-2");
		await expect(listMcpGrants(db, "owner-1")).resolves.toEqual([]);
	});
});
