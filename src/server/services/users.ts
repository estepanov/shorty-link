import {
	and,
	count,
	desc,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AppDb } from "../db/client";
import {
	adminInvites,
	roles,
	session,
	SYSTEM_ROLE_OWNER,
	user,
} from "../db/schema";
import { escapeLikePattern, likeEscaped } from "./utils";

export async function listUsers(
	db: AppDb,
	input: {
		active?: "all" | "active" | "inactive";
		page?: number;
		pageSize?: number;
		search?: string;
	} = {},
) {
	const inviter = alias(user, "inviter");
	const page = Math.max(1, Math.floor(input.page ?? 1));
	const pageSize = Math.max(1, Math.min(Math.floor(input.pageSize ?? 25), 100));
	const offset = (page - 1) * pageSize;
	const filters = [];
	const search = input.search?.trim();

	if (search) {
		const pattern = escapeLikePattern(search);
		filters.push(
			or(likeEscaped(user.name, pattern), likeEscaped(user.email, pattern)),
		);
	}

	if (input.active === "active") {
		filters.push(eq(user.isActive, true));
	} else if (input.active === "inactive") {
		filters.push(eq(user.isActive, false));
	}

	const where = filters.length ? and(...filters) : undefined;

	const select = {
		id: user.id,
		name: user.name,
		email: user.email,
		roleId: user.roleId,
		roleName: roles.name,
		roleIsSystem: roles.isSystem,
		locale: user.locale,
		isActive: user.isActive,
		invitedBy: user.invitedBy,
		invitedByName: inviter.name,
		invitedByEmail: inviter.email,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	};

	const [rows, [{ total }]] = await Promise.all([
		db
			.select(select)
			.from(user)
			.innerJoin(roles, eq(user.roleId, roles.id))
			.leftJoin(inviter, eq(user.invitedBy, inviter.id))
			.where(where)
			.orderBy(desc(user.createdAt))
			.limit(pageSize)
			.offset(offset),
		db.select({ total: count() }).from(user).where(where),
	]);

	return {
		items: rows,
		page,
		pageSize,
		total: Number(total ?? 0),
		totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
	};
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

export async function listAllInvites(
	db: AppDb,
	input: {
		page?: number;
		pageSize?: number;
		search?: string;
		status?: "all" | "pending" | "expired" | "accepted";
	} = {},
) {
	const inviter = alias(user, "inviter");
	const page = Math.max(1, Math.floor(input.page ?? 1));
	const pageSize = Math.max(1, Math.min(Math.floor(input.pageSize ?? 25), 100));
	const offset = (page - 1) * pageSize;
	const filters = [];
	const search = input.search?.trim();

	if (search) {
		const pattern = escapeLikePattern(search);
		filters.push(
			or(
				likeEscaped(adminInvites.email, pattern),
				likeEscaped(inviter.name, pattern),
			),
		);
	}

	const nowMs = Date.now();

	if (input.status === "pending") {
		filters.push(
			and(isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, nowMs)),
		);
	} else if (input.status === "expired") {
		filters.push(
			and(isNull(adminInvites.acceptedAt), lte(adminInvites.expiresAt, nowMs)),
		);
	} else if (input.status === "accepted") {
		filters.push(isNotNull(adminInvites.acceptedAt));
	}

	const where = filters.length ? and(...filters) : undefined;

	const select = {
		id: adminInvites.id,
		email: adminInvites.email,
		token: adminInvites.token,
		roleId: adminInvites.roleId,
		roleName: roles.name,
		invitedBy: adminInvites.invitedBy,
		invitedByName: inviter.name,
		invitedByEmail: inviter.email,
		expiresAt: adminInvites.expiresAt,
		acceptedAt: adminInvites.acceptedAt,
		createdAt: adminInvites.createdAt,
	};

	const [rows, [{ total }]] = await Promise.all([
		db
			.select(select)
			.from(adminInvites)
			.innerJoin(roles, eq(adminInvites.roleId, roles.id))
			.leftJoin(inviter, eq(adminInvites.invitedBy, inviter.id))
			.where(where)
			.orderBy(desc(adminInvites.createdAt))
			.limit(pageSize)
			.offset(offset),
		db.select({ total: count() }).from(adminInvites).where(where),
	]);

	const items = rows.map((row) => {
		let status: "pending" | "expired" | "accepted";
		if (row.acceptedAt) {
			status = "accepted";
		} else if (row.expiresAt < nowMs) {
			status = "expired";
		} else {
			status = "pending";
		}
		return { ...row, status };
	});

	return {
		items,
		page,
		pageSize,
		total: Number(total ?? 0),
		totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
	};
}

export async function deleteInvite(db: AppDb, inviteId: string) {
	await db.delete(adminInvites).where(eq(adminInvites.id, inviteId));
}
