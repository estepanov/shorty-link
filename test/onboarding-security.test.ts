import { mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import {
	completePasskeyRegistrationUser,
	createBootstrapContext,
	createInviteContext,
	resolvePasskeyRegistrationUser,
} from "../src/server/auth/onboarding";
import {
	adminInvites,
	SYSTEM_ROLE_ADMIN,
	schema,
	user,
} from "../src/server/db/schema";
import { deleteInvite, listAllInvites } from "../src/server/services/users";
import { applyD1Migrations } from "./apply-d1-migrations";

describe("onboarding security", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const localRequest = new Request("http://localhost:8787/admin");

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

	it("rejects onboarding context signing without a production auth secret", async () => {
		await expect(
			createBootstrapContext(
				db,
				{
					email: "first@example.com",
					name: "First Admin",
				},
				new Request("https://short.example.com/admin"),
			),
		).rejects.toThrow("BETTER_AUTH_SECRET is required");
	});

	it("requires a valid unaccepted invite before attaching a passkey", async () => {
		const timestamp = new Date();
		await db.insert(user).values({
			id: "inviter-admin",
			email: "inviter@example.com",
			emailVerified: true,
			image: null,
			locale: "en",
			name: "Inviter Admin",
			roleId: SYSTEM_ROLE_ADMIN,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		await db.insert(user).values({
			id: "existing-admin",
			email: "admin@example.com",
			emailVerified: true,
			image: null,
			locale: "en",
			name: "Existing Admin",
			roleId: SYSTEM_ROLE_ADMIN,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		await db.insert(adminInvites).values({
			id: "invite-1",
			email: "admin@example.com",
			token: "valid-invite-token-for-admin",
			roleId: SYSTEM_ROLE_ADMIN,
			invitedBy: "inviter-admin",
			expiresAt: Date.now() + 60_000,
			acceptedAt: null,
			createdAt: Date.now(),
		});

		const context = await createInviteContext(
			db,
			{
				name: "Existing Admin",
				token: "valid-invite-token-for-admin",
			},
			localRequest,
		);

		await expect(
			resolvePasskeyRegistrationUser(db, context, localRequest),
		).resolves.toMatchObject({
			email: "admin@example.com",
			id: "existing-admin",
		});
		await expect(
			completePasskeyRegistrationUser(
				db,
				context,
				"existing-admin",
				localRequest,
			),
		).resolves.toBe("existing-admin");

		const [invite] = await db
			.select()
			.from(adminInvites)
			.where(eq(adminInvites.id, "invite-1"));
		expect(invite?.acceptedAt).toEqual(expect.any(Number));

		const [updatedUser] = await db
			.select()
			.from(user)
			.where(eq(user.id, "existing-admin"));
		expect(updatedUser?.invitedBy).toBe("inviter-admin");

		await expect(
			resolvePasskeyRegistrationUser(db, context, localRequest),
		).rejects.toThrow("errors.inviteMissing");
	});

	it("does not cancel an accepted invite", async () => {
		const timestamp = Date.now();
		await db.insert(user).values({
			id: "accepted-user",
			email: "accepted@example.com",
			emailVerified: true,
			image: null,
			locale: "en",
			name: "Accepted User",
			roleId: SYSTEM_ROLE_ADMIN,
			createdAt: new Date(timestamp),
			updatedAt: new Date(timestamp),
		});
		await db.insert(adminInvites).values({
			id: "accepted-invite",
			email: "accepted@example.com",
			token: "accepted-invite-token",
			roleId: SYSTEM_ROLE_ADMIN,
			invitedBy: null,
			expiresAt: timestamp + 60_000,
			acceptedAt: timestamp,
			createdAt: timestamp,
		});

		await expect(deleteInvite(db, "accepted-invite")).rejects.toThrow(
			"errors.inviteAccepted",
		);

		const rows = await db
			.select({ id: adminInvites.id })
			.from(adminInvites)
			.where(eq(adminInvites.id, "accepted-invite"));
		expect(rows).toHaveLength(1);

		const invites = await listAllInvites(db, { status: "accepted" });
		expect(invites.items[0]).toMatchObject({
			id: "accepted-invite",
			acceptedUserId: "accepted-user",
			status: "accepted",
		});
	});

	it("cancels an unaccepted invite", async () => {
		const timestamp = Date.now();
		await db.insert(adminInvites).values({
			id: "pending-invite",
			email: "pending@example.com",
			token: "pending-invite-token",
			roleId: SYSTEM_ROLE_ADMIN,
			invitedBy: null,
			expiresAt: timestamp + 60_000,
			acceptedAt: null,
			createdAt: timestamp,
		});

		await expect(deleteInvite(db, "pending-invite")).resolves.toBeUndefined();

		const rows = await db
			.select({ id: adminInvites.id })
			.from(adminInvites)
			.where(eq(adminInvites.id, "pending-invite"));
		expect(rows).toHaveLength(0);
	});
});
