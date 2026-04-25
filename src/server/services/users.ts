import { and, desc, eq, ne, sql } from "drizzle-orm";

import type { AppDb } from "../db/client";
import {
	adminInvites,
	roles,
	session,
	SYSTEM_ROLE_OWNER,
	user,
} from "../db/schema";

export async function listUsers(db: AppDb) {
	return db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			roleId: user.roleId,
			roleName: roles.name,
			roleIsSystem: roles.isSystem,
			locale: user.locale,
			isActive: user.isActive,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		})
		.from(user)
		.innerJoin(roles, eq(user.roleId, roles.id))
		.orderBy(desc(user.createdAt));
}

export async function toggleUserActive(
	db: AppDb,
	userId: string,
	isActive: boolean,
) {
	if (!isActive) {
		await assertOwnerSurvives(db, {
			excludeUserId: userId,
		});
	}

	await db
		.update(user)
		.set({ isActive, updatedAt: new Date() })
		.where(eq(user.id, userId));

	if (!isActive) {
		await db.delete(session).where(eq(session.userId, userId));
	}
}

export async function deleteUser(db: AppDb, userId: string) {
	await assertOwnerSurvives(db, { excludeUserId: userId });
	await db.delete(user).where(eq(user.id, userId));
}

export async function assignUserRole(
	db: AppDb,
	userId: string,
	roleId: string,
) {
	const roleRows = await db
		.select({ id: roles.id })
		.from(roles)
		.where(eq(roles.id, roleId))
		.limit(1);
	if (!roleRows[0]) {
		throw new Error("errors.roleMissing");
	}

	const currentRows = await db
		.select({ roleId: user.roleId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!currentRows[0]) {
		throw new Error("errors.profileEmailTaken");
	}

	// If demoting an owner, require another active owner.
	if (
		currentRows[0].roleId === SYSTEM_ROLE_OWNER &&
		roleId !== SYSTEM_ROLE_OWNER
	) {
		await assertOwnerSurvives(db, { excludeUserId: userId });
	}

	await db
		.update(user)
		.set({ roleId, updatedAt: new Date() })
		.where(eq(user.id, userId));
}

export async function assertOwnerSurvives(
	db: AppDb,
	options: { excludeUserId?: string } = {},
) {
	const conditions = [
		eq(user.roleId, SYSTEM_ROLE_OWNER),
		eq(user.isActive, true),
	];
	if (options.excludeUserId) {
		conditions.push(ne(user.id, options.excludeUserId));
	}

	const [row] = await db
		.select({ total: sql<number>`count(*)` })
		.from(user)
		.where(and(...conditions));

	if (Number(row?.total ?? 0) < 1) {
		throw new Error("errors.lastOwner");
	}
}

export async function listAllInvites(db: AppDb) {
	return db
		.select({
			id: adminInvites.id,
			email: adminInvites.email,
			token: adminInvites.token,
			roleId: adminInvites.roleId,
			roleName: roles.name,
			invitedBy: adminInvites.invitedBy,
			expiresAt: adminInvites.expiresAt,
			acceptedAt: adminInvites.acceptedAt,
			createdAt: adminInvites.createdAt,
		})
		.from(adminInvites)
		.innerJoin(roles, eq(adminInvites.roleId, roles.id))
		.orderBy(desc(adminInvites.createdAt));
}

export async function deleteInvite(db: AppDb, inviteId: string) {
	await db.delete(adminInvites).where(eq(adminInvites.id, inviteId));
}
