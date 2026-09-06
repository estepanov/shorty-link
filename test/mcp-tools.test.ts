import { mkdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { AuthContext } from "../src/server/auth/session";
import { callMcpTool } from "../src/server/mcp/tools";
import { schema, SYSTEM_ROLE_OWNER, user } from "../src/server/db/schema";
import { getLinkById, saveLink } from "../src/server/services/links";
import { createRole } from "../src/server/services/roles";
import { applyD1Migrations } from "./apply-d1-migrations";

function context(
	overrides: Partial<AuthContext> & {
		permissions: AuthContext["permissions"];
	},
): AuthContext {
	return {
		user: {
			id: "reader-1",
			email: "reader-1@example.com",
			name: "reader-1",
			locale: "en",
			isActive: true,
		},
		role: { id: "reader", name: "Reader", isSystem: false },
		domainScope: null,
		linkScope: null,
		...overrides,
	};
}

describe("mcp tools", () => {
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

	it("whoami returns the authenticated identity", async () => {
		const result = await callMcpTool(
			"whoami",
			{},
			context({ permissions: new Set(["links.read"]) }),
			db,
		);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("reader-1@example.com");
	});

	it("refuses write tools without permission", async () => {
		const result = await callMcpTool(
			"create_link",
			{ targetUrl: "https://example.com" },
			context({ permissions: new Set(["links.read"]) }),
			db,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("errors.permissionDenied");
	});

	it("lists and creates links when the role allows it", async () => {
		const ts = new Date();
		const roleId = await createRole(db, {
			name: "Link Writer",
			permissions: ["links.read", "links.write"],
		});
		await db.insert(user).values({
			id: "writer-1",
			name: "writer-1",
			email: "writer-1@example.com",
			emailVerified: true,
			image: null,
			roleId,
			locale: "en",
			isActive: true,
			mcpAccessEnabled: true,
			createdAt: ts,
			updatedAt: ts,
		});
		await saveLink(db, {
			targetUrl: "https://example.com/docs",
			slug: "docs",
			createdBy: "writer-1",
		});

		const ctx = context({
			user: {
				id: "writer-1",
				email: "writer-1@example.com",
				name: "writer-1",
				locale: "en",
				isActive: true,
			},
			role: { id: roleId, name: "Link Writer", isSystem: false },
			permissions: new Set(["links.read", "links.write"]),
		});

		const listed = await callMcpTool("list_links", {}, ctx, db);
		expect(listed.isError).toBeUndefined();
		expect(listed.content[0]?.text).toContain("docs");

		const created = await callMcpTool(
			"create_link",
			{ targetUrl: "https://example.com/new", slug: "new-link" },
			ctx,
			db,
		);
		expect(created.isError).toBeUndefined();
		expect(created.content[0]?.text).toContain("new-link");
	});

	it("hides out-of-scope links from readers", async () => {
		const allowedId = await saveLink(db, {
			targetUrl: "https://example.com/allowed",
			slug: "allowed",
		});
		const hiddenId = await saveLink(db, {
			targetUrl: "https://example.com/hidden",
			slug: "hidden",
		});
		const ctx = context({
			permissions: new Set(["links.read"]),
			linkScope: new Set([allowedId]),
		});

		const listed = await callMcpTool("list_links", {}, ctx, db);
		expect(listed.content[0]?.text).toContain("allowed");
		expect(listed.content[0]?.text).not.toContain("hidden");

		const hidden = await callMcpTool("get_link", { id: hiddenId }, ctx, db);
		expect(hidden.isError).toBe(true);
	});

	it("owner can delete a link through MCP", async () => {
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
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const id = await saveLink(db, {
			targetUrl: "https://example.com/gone",
			slug: "gone",
			createdBy: "owner-1",
		});
		const result = await callMcpTool(
			"delete_link",
			{ id },
			context({
				user: {
					id: "owner-1",
					email: "owner-1@example.com",
					name: "owner-1",
					locale: "en",
					isActive: true,
				},
				role: { id: SYSTEM_ROLE_OWNER, name: "Owner", isSystem: true },
				permissions: new Set(["links.delete"]),
			}),
			db,
		);
		expect(result.isError).toBeUndefined();
		await expect(getLinkById(db, id)).resolves.toBeNull();
	});
});
