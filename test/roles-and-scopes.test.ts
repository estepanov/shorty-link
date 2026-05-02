import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
	roleDomainScopes,
	roleLinkScopes,
	roles,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	schema,
	shortLinks,
	user,
} from "../src/server/db/schema";
import {
	appendDomainToRoleScopeIfScoped,
	appendLinkToRoleScopeIfScoped,
	listShortLinks,
	saveDomain,
	saveLink,
} from "../src/server/services/links";
import {
	createRole,
	deleteRole,
	getRoleById,
	listRoles,
	updateRole,
} from "../src/server/services/roles";
import { assignUserRole } from "../src/server/services/users";

async function applyMigrations(database: D1Database) {
	for (const file of [
		"0000_fresh_shorty_link.sql",
		"0001_redirect_event_utm.sql",
		"0002_short_link_last_click.sql",
		"0005_managed_domain_fallbacks.sql",
		"0003_user_is_active.sql",
		"0004_roles_and_scopes.sql",
		"0006_user_invited_by.sql",
	]) {
		const statements = readFileSync(
			join(process.cwd(), "migrations", file),
			"utf8",
		)
			.split(";")
			.map((statement) => statement.trim())
			.filter(Boolean);
		for (const statement of statements) {
			await database.prepare(statement).run();
		}
	}
}

async function seedActiveUser(
	db: ReturnType<typeof drizzle<typeof schema>>,
	id: string,
	roleId: string,
) {
	const ts = new Date();
	await db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
		emailVerified: true,
		image: null,
		roleId,
		locale: "en",
		isActive: true,
		createdAt: ts,
		updatedAt: ts,
	});
}

describe("roles and scopes", () => {
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
		await applyMigrations(database);
		db = drizzle(database, { schema });
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("seeds owner and admin system roles with all permissions", async () => {
		const { items: list } = await listRoles(db);
		const owner = list.find((r) => r.id === SYSTEM_ROLE_OWNER);
		const admin = list.find((r) => r.id === SYSTEM_ROLE_ADMIN);
		expect(owner).toBeDefined();
		expect(admin).toBeDefined();
		expect(owner?.isSystem).toBe(true);
		expect(admin?.isSystem).toBe(true);
		expect(owner?.permissions).toContain("links.write");
		expect(owner?.permissions).toContain("sessions.manage");
	});

	it("blocks editing or deleting system roles", async () => {
		await expect(
			updateRole(db, SYSTEM_ROLE_OWNER, {
				name: "Renamed",
				permissions: ["links.read"],
			}),
		).rejects.toThrow("errors.roleSystem");
		await expect(deleteRole(db, SYSTEM_ROLE_ADMIN)).rejects.toThrow(
			"errors.roleSystem",
		);
	});

	it("creates, edits, and deletes a custom role with scope rows", async () => {
		const domainId = await saveDomain(db, { hostname: "x.example.com" });

		const id = await createRole(db, {
			name: "X Manager",
			description: "Manages X",
			permissions: ["links.read", "links.write"],
			domainScopeIds: [domainId],
		});

		const detail = await getRoleById(db, id);
		expect(detail?.name).toBe("X Manager");
		expect(detail?.permissions).toEqual(
			expect.arrayContaining(["links.read", "links.write"]),
		);
		expect(detail?.domainScopeIds).toEqual([domainId]);

		await updateRole(db, id, {
			name: "X Manager",
			permissions: ["links.read"],
			domainScopeIds: [domainId],
		});
		const updated = await getRoleById(db, id);
		expect(updated?.permissions).toEqual(["links.read"]);

		await deleteRole(db, id);
		expect(await getRoleById(db, id)).toBeNull();
	});

	it("rejects deleting a role that is in use", async () => {
		const id = await createRole(db, {
			name: "Custom",
			permissions: ["links.read"],
		});
		await seedActiveUser(db, "alice", id);

		await expect(deleteRole(db, id)).rejects.toThrow("errors.roleInUse");
	});

	it("enforces last-owner protection on assignUserRole", async () => {
		await seedActiveUser(db, "owner-1", SYSTEM_ROLE_OWNER);
		await expect(
			assignUserRole(db, "owner-1", SYSTEM_ROLE_ADMIN),
		).rejects.toThrow("errors.lastOwner");

		await seedActiveUser(db, "owner-2", SYSTEM_ROLE_OWNER);
		await expect(
			assignUserRole(db, "owner-1", SYSTEM_ROLE_ADMIN),
		).resolves.toBeUndefined();
	});

	it("filters listShortLinks by domain hostname scope", async () => {
		const xDomain = await saveDomain(db, { hostname: "x.example.com" });
		await saveDomain(db, { hostname: "y.example.com" });
		await saveLink(db, {
			hostname: "x.example.com",
			slug: "promo",
			targetUrl: "https://x.test/promo",
		});
		await saveLink(db, {
			hostname: "y.example.com",
			slug: "promo",
			targetUrl: "https://y.test/promo",
		});

		const unrestricted = await listShortLinks(db, {});
		expect(unrestricted.items).toHaveLength(2);

		const scoped = await listShortLinks(
			db,
			{},
			{ hostnames: new Set(["x.example.com"]), linkIds: null },
		);
		expect(scoped.items).toHaveLength(1);
		expect(scoped.items[0]?.hostname).toBe("x.example.com");

		// linkScope-only union: include just one specific link id
		expect(scoped.items[0]?.id).toBeDefined();
		const yRows = await db
			.select({ id: shortLinks.id, hostname: shortLinks.hostname })
			.from(shortLinks)
			.where(eq(shortLinks.hostname, "y.example.com"));
		expect(yRows[0]?.id).toBeDefined();
		const yLinkId = yRows[0]?.id as string;
		const onlyY = await listShortLinks(
			db,
			{},
			{ hostnames: null, linkIds: new Set([yLinkId]) },
		);
		expect(onlyY.items).toHaveLength(1);
		expect(onlyY.items[0]?.hostname).toBe("y.example.com");

		// union of both
		const union = await listShortLinks(
			db,
			{},
			{
				hostnames: new Set(["x.example.com"]),
				linkIds: new Set([yLinkId]),
			},
		);
		expect(union.items).toHaveLength(2);
		void xDomain;
	});

	it("auto-adds new domain to creator's role scope only when role already has scope rows", async () => {
		const seedDomain = await saveDomain(db, { hostname: "seed.example.com" });
		const scopedRoleId = await createRole(db, {
			name: "Scoped Role",
			permissions: ["domains.read", "domains.write"],
			domainScopeIds: [seedDomain],
		});
		const unscopedRoleId = await createRole(db, {
			name: "Unscoped Role",
			permissions: ["domains.read", "domains.write"],
		});

		const newDomainId = await saveDomain(db, {
			hostname: "newone.example.com",
		});
		await appendDomainToRoleScopeIfScoped(db, scopedRoleId, newDomainId);
		await appendDomainToRoleScopeIfScoped(db, unscopedRoleId, newDomainId);

		const scopedRows = await db
			.select()
			.from(roleDomainScopes)
			.where(eq(roleDomainScopes.roleId, scopedRoleId));
		expect(scopedRows.map((r) => r.domainId).sort()).toEqual(
			[seedDomain, newDomainId].sort(),
		);

		const unscopedRows = await db
			.select()
			.from(roleDomainScopes)
			.where(eq(roleDomainScopes.roleId, unscopedRoleId));
		expect(unscopedRows).toHaveLength(0);
	});

	it("auto-adds new link to creator's role scope only when role already has link scope rows", async () => {
		await saveDomain(db, { hostname: "go.example.com" });
		const seedLink = await saveLink(db, {
			hostname: "go.example.com",
			slug: "seed",
			targetUrl: "https://example.com/seed",
		});
		const scopedRoleId = await createRole(db, {
			name: "Link Scoped",
			permissions: ["links.read", "links.write"],
			linkScopeIds: [seedLink],
		});
		const unscopedRoleId = await createRole(db, {
			name: "Link Unscoped",
			permissions: ["links.read", "links.write"],
		});

		const newLinkId = await saveLink(db, {
			hostname: "go.example.com",
			slug: "newone",
			targetUrl: "https://example.com/new",
		});
		await appendLinkToRoleScopeIfScoped(db, scopedRoleId, newLinkId);
		await appendLinkToRoleScopeIfScoped(db, unscopedRoleId, newLinkId);

		const scopedRows = await db
			.select()
			.from(roleLinkScopes)
			.where(eq(roleLinkScopes.roleId, scopedRoleId));
		expect(scopedRows.map((r) => r.linkId).sort()).toEqual(
			[seedLink, newLinkId].sort(),
		);

		const unscopedRows = await db
			.select()
			.from(roleLinkScopes)
			.where(eq(roleLinkScopes.roleId, unscopedRoleId));
		expect(unscopedRows).toHaveLength(0);
	});

	it("rejects role updates with no permissions", async () => {
		const id = await createRole(db, {
			name: "Temp",
			permissions: ["links.read"],
		});
		await expect(
			updateRole(db, id, { name: "Temp", permissions: [] }),
		).rejects.toThrow("errors.roleNoPermissions");
	});

	it("rejects duplicate role names", async () => {
		await createRole(db, { name: "Manager", permissions: ["links.read"] });
		await expect(
			createRole(db, { name: "Manager", permissions: ["links.read"] }),
		).rejects.toThrow("errors.roleNameTaken");
	});

	it("preserves existing role rows after migration", async () => {
		const ownerRow = await db
			.select()
			.from(roles)
			.where(eq(roles.id, SYSTEM_ROLE_OWNER));
		expect(ownerRow).toHaveLength(1);
		expect(ownerRow[0]?.name).toBe("Owner");
	});
});
