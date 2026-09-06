import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
	adminInvites,
	roles,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	schema,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../src/server/db/schema";
import {
	applySsoAdmission,
	prepareSsoAdmission,
} from "../src/server/services/sso-providers";
import { applyD1Migrations } from "./apply-d1-migrations";

describe("D1 SSO admission persistence", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let database: D1Database;
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
		database = (proxy.env as { DB: D1Database }).DB;
		db = drizzle(database, { schema });
		await applyD1Migrations(database);

		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: "owner@acme.test",
			emailVerified: true,
			id: "owner",
			image: null,
			isActive: true,
			locale: "en",
			name: "Owner",
			roleId: SYSTEM_ROLE_OWNER,
			updatedAt: timestamp,
		});
		await db.insert(ssoProvider).values({
			domain: "acme.test",
			id: "provider-row",
			issuer: "https://idp.example.test",
			oidcConfig: "{}",
			organizationId: null,
			providerId: "workforce",
			samlConfig: null,
			userId: "owner",
		});
		await db.insert(ssoProviderSettings).values({
			allowIdpInitiated: false,
			createdAt: Date.now(),
			defaultRoleId: SYSTEM_ROLE_ADMIN,
			displayName: "Workforce",
			enabled: true,
			enforceSso: true,
			groupClaim: "groups",
			groupRoleMappings: "[]",
			jitEnabled: false,
			protocol: "oidc",
			providerId: "workforce",
			updatedAt: Date.now(),
		});
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("atomically claims an invite before activating the Better Auth user", async () => {
		await db.insert(adminInvites).values({
			acceptedAt: null,
			createdAt: Date.now(),
			email: "member@acme.test",
			expiresAt: Date.now() + 60_000,
			id: "invite",
			invitedBy: "owner",
			roleId: SYSTEM_ROLE_ADMIN,
			ssoClaimId: null,
			token: "invite-token",
		});
		const prepared = await prepareSsoAdmission(db, {
			email: "member@acme.test",
			emailVerified: true,
			profile: { groups: [] },
			providerId: "workforce",
		});
		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: prepared.email,
			emailVerified: true,
			id: "member",
			image: null,
			isActive: false,
			invitedBy: "owner",
			locale: "en",
			name: "Member",
			roleId: SYSTEM_ROLE_ADMIN,
			updatedAt: timestamp,
		});

		await expect(applySsoAdmission(db, prepared, "member")).resolves.toEqual({
			userId: "member",
		});

		const [acceptedInvite] = await db
			.select()
			.from(adminInvites)
			.where(eq(adminInvites.id, "invite"));
		const [member] = await db.select().from(user).where(eq(user.id, "member"));
		expect(acceptedInvite).toMatchObject({
			acceptedAt: expect.any(Number),
			ssoClaimId: "member",
		});
		expect(member).toMatchObject({
			invitedBy: "owner",
			isActive: true,
			roleId: SYSTEM_ROLE_ADMIN,
		});
	});

	it("removes the inactive staged user when another callback wins the invite", async () => {
		await db.insert(adminInvites).values({
			acceptedAt: null,
			createdAt: Date.now(),
			email: "member@acme.test",
			expiresAt: Date.now() + 60_000,
			id: "invite",
			invitedBy: "owner",
			roleId: SYSTEM_ROLE_ADMIN,
			ssoClaimId: null,
			token: "invite-token",
		});
		const prepared = await prepareSsoAdmission(db, {
			email: "member@acme.test",
			emailVerified: true,
			profile: { groups: [] },
			providerId: "workforce",
		});
		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: prepared.email,
			emailVerified: true,
			id: "member",
			image: null,
			isActive: false,
			invitedBy: "owner",
			locale: "en",
			name: "Member",
			roleId: SYSTEM_ROLE_ADMIN,
			updatedAt: timestamp,
		});
		await db
			.update(adminInvites)
			.set({
				acceptedAt: Date.now(),
			})
			.where(eq(adminInvites.id, "invite"));

		await expect(applySsoAdmission(db, prepared, "member")).rejects.toThrow(
			"errors.ssoNotProvisioned",
		);

		const [invite] = await db
			.select()
			.from(adminInvites)
			.where(eq(adminInvites.id, "invite"));
		expect(invite).toMatchObject({
			acceptedAt: expect.any(Number),
			ssoClaimId: null,
		});
		expect(
			await db.select().from(user).where(eq(user.id, "member")),
		).toHaveLength(0);
	});

	it("restores its invite claim and removes the staged user when the admission batch throws", async () => {
		await db.insert(adminInvites).values({
			acceptedAt: null,
			createdAt: Date.now(),
			email: "member@acme.test",
			expiresAt: Date.now() + 60_000,
			id: "invite",
			invitedBy: "owner",
			roleId: SYSTEM_ROLE_ADMIN,
			ssoClaimId: null,
			token: "invite-token",
		});
		const prepared = await prepareSsoAdmission(db, {
			email: "member@acme.test",
			emailVerified: true,
			profile: { groups: [] },
			providerId: "workforce",
		});
		const timestamp = new Date();
		await db.insert(user).values({
			createdAt: timestamp,
			email: prepared.email,
			emailVerified: true,
			id: "member",
			image: null,
			isActive: false,
			invitedBy: "owner",
			locale: "en",
			name: "Member",
			roleId: SYSTEM_ROLE_ADMIN,
			updatedAt: timestamp,
		});
		await database
			.prepare(`
				CREATE TRIGGER fail_sso_user_activation
				BEFORE UPDATE OF is_active ON user
				WHEN NEW.id = 'member'
				BEGIN
					SELECT RAISE(FAIL, 'injected activation failure');
				END
			`)
			.run();

		await expect(applySsoAdmission(db, prepared, "member")).rejects.toThrow(
			"injected activation failure",
		);

		const [invite] = await db
			.select()
			.from(adminInvites)
			.where(eq(adminInvites.id, "invite"));
		expect(invite).toMatchObject({
			acceptedAt: null,
			ssoClaimId: null,
		});
		expect(
			await db.select().from(user).where(eq(user.id, "member")),
		).toHaveLength(0);
	});

	it("selects only live invites and deterministically prefers the newest", async () => {
		const timestamp = Date.now();
		await db.insert(adminInvites).values([
			{
				acceptedAt: null,
				createdAt: timestamp - 30_000,
				email: "member@acme.test",
				expiresAt: timestamp - 1,
				id: "expired",
				invitedBy: "owner",
				roleId: SYSTEM_ROLE_ADMIN,
				ssoClaimId: null,
				token: "expired-token",
			},
			{
				acceptedAt: null,
				createdAt: timestamp - 20_000,
				email: "member@acme.test",
				expiresAt: timestamp + 60_000,
				id: "older-valid",
				invitedBy: "owner",
				roleId: SYSTEM_ROLE_ADMIN,
				ssoClaimId: null,
				token: "older-valid-token",
			},
			{
				acceptedAt: null,
				createdAt: timestamp - 10_000,
				email: "member@acme.test",
				expiresAt: timestamp + 60_000,
				id: "newest-valid",
				invitedBy: "owner",
				roleId: SYSTEM_ROLE_ADMIN,
				ssoClaimId: null,
				token: "newest-valid-token",
			},
		]);

		const prepared = await prepareSsoAdmission(db, {
			email: "member@acme.test",
			emailVerified: true,
			profile: { groups: [] },
			providerId: "workforce",
		});

		expect(prepared.decision).toMatchObject({
			action: "invite",
			token: "newest-valid-token",
		});
	});

	it("ignores group mappings whose role was deleted after configuration", async () => {
		const timestamp = new Date();
		await db.insert(roles).values({
			createdAt: timestamp,
			description: null,
			id: "deleted-role",
			isSystem: false,
			name: "Deleted role",
			permissions: "[]",
			updatedAt: timestamp,
		});
		await db
			.update(ssoProviderSettings)
			.set({
				groupRoleMappings: JSON.stringify([
					{ group: "eng", roleId: "deleted-role" },
				]),
				jitEnabled: true,
			})
			.where(eq(ssoProviderSettings.providerId, "workforce"));
		await db.delete(roles).where(eq(roles.id, "deleted-role"));

		const prepared = await prepareSsoAdmission(db, {
			email: "new@acme.test",
			emailVerified: true,
			profile: { groups: ["eng"] },
			providerId: "workforce",
		});

		expect(prepared.decision).toEqual({
			action: "jit",
			ok: true,
			roleId: SYSTEM_ROLE_ADMIN,
		});
	});
});
