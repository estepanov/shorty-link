import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { parsePermissions } from "../src/lib/permissions";
import {
	roles,
	schema,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
} from "../src/server/db/schema";
import { applyD1Migrations } from "./apply-d1-migrations";

describe("sso schema migration", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;

	beforeEach(async () => {
		mkdirSync("/tmp/wrangler-logs", { recursive: true });
		process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
		process.env.WRANGLER_LOG = "error";
		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		await applyD1Migrations((proxy.env as { DB: D1Database }).DB);
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("grants sso permissions to system roles only", async () => {
		const db = drizzle((proxy?.env as { DB: D1Database }).DB, { schema });
		const rows = await db
			.select({
				id: roles.id,
				permissions: roles.permissions,
			})
			.from(roles)
			.where(eq(roles.isSystem, true));

		for (const row of rows) {
			if (row.id === SYSTEM_ROLE_OWNER || row.id === SYSTEM_ROLE_ADMIN) {
				const permissions = parsePermissions(row.permissions);
				expect(permissions.has("sso.read")).toBe(true);
				expect(permissions.has("sso.write")).toBe(true);
				expect(permissions.has("sso.delete")).toBe(true);
			}
		}
	});
});
