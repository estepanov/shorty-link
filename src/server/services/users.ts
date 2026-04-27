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
import { normalizeLocale } from "../../lib/i18n";
import type { AppDb } from "../db/client";
import {
	adminInvites,
	roles,
	SYSTEM_ROLE_OWNER,
	session,
	user,
} from "../db/schema";
import { escapeLikePattern, likeEscaped } from "./utils";

export async function listUsers(
	db: AppDb,
	input: {
		active?: "all" | "active" | "inactive";
		page?: number;
		pageSize?: number;
		roleId?: string;
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

	if (input.roleId) {
		filters.push(eq(user.roleId, input.roleId));
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

export async function getUserById(db: AppDb, userId: string) {
	const inviter = alias(user, "inviter");
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
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
		})
		.from(user)
		.innerJoin(roles, eq(user.roleId, roles.id))
		.leftJoin(inviter, eq(user.invitedBy, inviter.id))
		.where(eq(user.id, userId))
		.limit(1);

	if (!rows[0]) {
		throw new Error("errors.userMissing");
	}
	return rows[0];
}

export async function updateUser(
	db: AppDb,
	userId: string,
	input: {
		name?: string;
		email?: string;
		locale?: string;
		isActive?: boolean;
	},
) {
	if (input.email) {
		const trimmed = input.email.trim().toLowerCase();
		const existing = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.email, trimmed), ne(user.id, userId)))
			.limit(1);
		if (existing[0]) {
			throw new Error("errors.profileEmailTaken");
		}
	}

	if (input.isActive === false) {
		await assertOwnerSurvives(db, { excludeUserId: userId });
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) updates.name = input.name.trim();
	if (input.email !== undefined)
		updates.email = input.email.trim().toLowerCase();
	if (input.locale !== undefined)
		updates.locale = normalizeLocale(input.locale);
	if (input.isActive !== undefined) updates.isActive = input.isActive;

	await db.update(user).set(updates).where(eq(user.id, userId));

	if (input.isActive === false) {
		await db.delete(session).where(eq(session.userId, userId));
	}
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
		roleId?: string;
		search?: string;
		status?: "all" | "pending" | "expired" | "accepted";
	} = {},
) {
	const inviter = alias(user, "inviter");
	const acceptedUser = alias(user, "acceptedUser");
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

	if (input.roleId) {
		filters.push(eq(adminInvites.roleId, input.roleId));
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
		acceptedUserId: acceptedUser.id,
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
			.leftJoin(acceptedUser, eq(adminInvites.email, acceptedUser.email))
			.where(where)
			.orderBy(desc(adminInvites.createdAt))
			.limit(pageSize)
			.offset(offset),
		db
			.select({ total: count() })
			.from(adminInvites)
			.leftJoin(inviter, eq(adminInvites.invitedBy, inviter.id))
			.where(where),
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
		return {
			...row,
			acceptedUserId: status === "accepted" ? row.acceptedUserId : null,
			status,
		};
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
	const rows = await db
		.select({
			acceptedAt: adminInvites.acceptedAt,
			expiresAt: adminInvites.expiresAt,
		})
		.from(adminInvites)
		.where(eq(adminInvites.id, inviteId))
		.limit(1);
	const invite = rows[0];

	if (!invite) {
		throw new Error("errors.inviteMissing");
	}

	if (invite.acceptedAt) {
		throw new Error("errors.inviteAccepted");
	}

	if (invite.expiresAt <= Date.now()) {
		throw new Error("errors.inviteExpired");
	}

	await db.delete(adminInvites).where(eq(adminInvites.id, inviteId));
}

export async function getInviteById(db: AppDb, inviteId: string) {
	const inviter = alias(user, "inviter");

	const rows = await db
		.select({
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
		})
		.from(adminInvites)
		.innerJoin(roles, eq(adminInvites.roleId, roles.id))
		.leftJoin(inviter, eq(adminInvites.invitedBy, inviter.id))
		.where(eq(adminInvites.id, inviteId))
		.limit(1);

	const row = rows[0];
	if (!row) {
		throw new Error("errors.inviteMissing");
	}

	const nowMs = Date.now();
	let status: "pending" | "expired" | "accepted";
	if (row.acceptedAt) {
		status = "accepted";
	} else if (row.expiresAt < nowMs) {
		status = "expired";
	} else {
		status = "pending";
	}

	return { ...row, status };
}
