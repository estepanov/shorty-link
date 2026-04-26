import {
	and,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";

import {
	type Permission,
	parsePermissions,
	serializePermissions,
} from "@/lib/permissions";

import type { AppDb } from "../db/client";
import {
	adminInvites,
	managedDomains,
	roleDomainScopes,
	roleLinkScopes,
	roles,
	shortLinks,
	SYSTEM_ROLE_OWNER,
	user,
} from "../db/schema";
import { escapeLikePattern, likeEscaped } from "./utils";

export type RoleSummary = {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	permissions: Permission[];
	userCount: number;
	pendingInviteCount: number;
	domainScopeCount: number;
	linkScopeCount: number;
	createdAt: Date;
	updatedAt: Date;
};

export type RoleDetail = RoleSummary & {
	domainScopeIds: string[];
	linkScopeIds: string[];
};

export type RoleInput = {
	name: string;
	description?: string | null;
	permissions: Permission[];
	domainScopeIds?: string[];
	linkScopeIds?: string[];
};

function normalizeName(value: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("errors.roleNameTaken");
	}
	if (trimmed.length > 64) {
		throw new Error("errors.roleNameTaken");
	}
	return trimmed;
}

function normalizePermissions(values: Permission[]): Permission[] {
	const set = parsePermissions(JSON.stringify(values));
	if (set.size === 0) {
		throw new Error("errors.roleNoPermissions");
	}
	return [...set];
}

async function assertUniqueName(db: AppDb, name: string, excludeId?: string) {
	const where = excludeId
		? and(eq(roles.name, name), ne(roles.id, excludeId))
		: eq(roles.name, name);
	const [existing] = await db
		.select({ id: roles.id })
		.from(roles)
		.where(where)
		.limit(1);
	if (existing) {
		throw new Error("errors.roleNameTaken");
	}
}

export async function listRoles(
	db: AppDb,
	input: {
		page?: number;
		pageSize?: number;
		search?: string;
	} = {},
) {
	const page = Math.max(1, Math.floor(input.page ?? 1));
	const pageSize = Math.max(1, Math.min(Math.floor(input.pageSize ?? 25), 100));
	const offset = (page - 1) * pageSize;
	const filters = [];
	const search = input.search?.trim();

	if (search) {
		const pattern = escapeLikePattern(search);
		filters.push(
			or(
				likeEscaped(roles.name, pattern),
				likeEscaped(roles.description, pattern),
			),
		);
	}

	const where = filters.length ? and(...filters) : undefined;

	const [rows, [{ total }]] = await Promise.all([
		db
			.select()
			.from(roles)
			.where(where)
			.orderBy(roles.name)
			.limit(pageSize)
			.offset(offset),
		db.select({ total: count() }).from(roles).where(where),
	]);

	if (!rows.length) {
		return {
			items: [],
			page,
			pageSize,
			total: Number(total ?? 0),
			totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
		};
	}

	const ids = rows.map((row) => row.id);
	const [userCounts, domainCounts, linkCounts, pendingInviteCounts] =
		await Promise.all([
			db
				.select({ roleId: user.roleId, total: count() })
				.from(user)
				.where(inArray(user.roleId, ids))
				.groupBy(user.roleId),
			db
				.select({ roleId: roleDomainScopes.roleId, total: count() })
				.from(roleDomainScopes)
				.where(inArray(roleDomainScopes.roleId, ids))
				.groupBy(roleDomainScopes.roleId),
			db
				.select({ roleId: roleLinkScopes.roleId, total: count() })
				.from(roleLinkScopes)
				.where(inArray(roleLinkScopes.roleId, ids))
				.groupBy(roleLinkScopes.roleId),
			db
				.select({ roleId: adminInvites.roleId, total: count() })
				.from(adminInvites)
				.where(
					and(
						inArray(adminInvites.roleId, ids),
						isNull(adminInvites.acceptedAt),
						gt(adminInvites.expiresAt, Date.now()),
					),
				)
				.groupBy(adminInvites.roleId),
		]);

	const userMap = new Map(
		userCounts.map((row) => [row.roleId, Number(row.total)]),
	);
	const domainMap = new Map(
		domainCounts.map((row) => [row.roleId, Number(row.total)]),
	);
	const linkMap = new Map(
		linkCounts.map((row) => [row.roleId, Number(row.total)]),
	);
	const pendingInviteMap = new Map(
		pendingInviteCounts.map((row) => [row.roleId, Number(row.total)]),
	);

	const items: RoleSummary[] = rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		isSystem: row.isSystem,
		permissions: [...parsePermissions(row.permissions)],
		userCount: userMap.get(row.id) ?? 0,
		pendingInviteCount: pendingInviteMap.get(row.id) ?? 0,
		domainScopeCount: domainMap.get(row.id) ?? 0,
		linkScopeCount: linkMap.get(row.id) ?? 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));

	return {
		items,
		page,
		pageSize,
		total: Number(total ?? 0),
		totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
	};
}

export async function getRoleById(
	db: AppDb,
	id: string,
): Promise<RoleDetail | null> {
	const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
	if (!row) {
		return null;
	}

	const [userRow, domainRows, linkRows, pendingInviteRow] = await Promise.all([
		db.select({ total: count() }).from(user).where(eq(user.roleId, id)),
		db
			.select({ domainId: roleDomainScopes.domainId })
			.from(roleDomainScopes)
			.where(eq(roleDomainScopes.roleId, id)),
		db
			.select({ linkId: roleLinkScopes.linkId })
			.from(roleLinkScopes)
			.where(eq(roleLinkScopes.roleId, id)),
		db
			.select({ total: count() })
			.from(adminInvites)
			.where(
				and(
					eq(adminInvites.roleId, id),
					isNull(adminInvites.acceptedAt),
					gt(adminInvites.expiresAt, Date.now()),
				),
			),
	]);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		isSystem: row.isSystem,
		permissions: [...parsePermissions(row.permissions)],
		userCount: Number(userRow[0]?.total ?? 0),
		pendingInviteCount: Number(pendingInviteRow[0]?.total ?? 0),
		domainScopeCount: domainRows.length,
		linkScopeCount: linkRows.length,
		domainScopeIds: domainRows.map((r) => r.domainId),
		linkScopeIds: linkRows.map((r) => r.linkId),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function validateScopeIds(
	db: AppDb,
	domainIds: string[],
	linkIds: string[],
) {
	if (domainIds.length) {
		const found = await db
			.select({ id: managedDomains.id })
			.from(managedDomains)
			.where(inArray(managedDomains.id, domainIds));
		if (found.length !== new Set(domainIds).size) {
			throw new Error("errors.domainMissing");
		}
	}
	if (linkIds.length) {
		const found = await db
			.select({ id: shortLinks.id })
			.from(shortLinks)
			.where(inArray(shortLinks.id, linkIds));
		if (found.length !== new Set(linkIds).size) {
			throw new Error("errors.linkMissing");
		}
	}
}

export async function createRole(db: AppDb, input: RoleInput) {
	const name = normalizeName(input.name);
	await assertUniqueName(db, name);
	const permissions = normalizePermissions(input.permissions);
	const domainIds = [...new Set(input.domainScopeIds ?? [])];
	const linkIds = [...new Set(input.linkScopeIds ?? [])];
	await validateScopeIds(db, domainIds, linkIds);

	const id = nanoid();
	const timestamp = new Date();
	await db.insert(roles).values({
		id,
		name,
		description: input.description?.trim() || null,
		permissions: serializePermissions(permissions),
		isSystem: false,
		createdAt: timestamp,
		updatedAt: timestamp,
	});

	if (domainIds.length) {
		await db.insert(roleDomainScopes).values(
			domainIds.map((domainId) => ({
				id: nanoid(),
				roleId: id,
				domainId,
				createdAt: timestamp,
			})),
		);
	}
	if (linkIds.length) {
		await db.insert(roleLinkScopes).values(
			linkIds.map((linkId) => ({
				id: nanoid(),
				roleId: id,
				linkId,
				createdAt: timestamp,
			})),
		);
	}

	return id;
}

export async function updateRole(db: AppDb, id: string, input: RoleInput) {
	const [existing] = await db
		.select()
		.from(roles)
		.where(eq(roles.id, id))
		.limit(1);
	if (!existing) {
		throw new Error("errors.roleMissing");
	}
	if (existing.isSystem) {
		throw new Error("errors.roleSystem");
	}

	const name = normalizeName(input.name);
	if (name !== existing.name) {
		await assertUniqueName(db, name, id);
	}
	const permissions = normalizePermissions(input.permissions);
	const domainIds = [...new Set(input.domainScopeIds ?? [])];
	const linkIds = [...new Set(input.linkScopeIds ?? [])];
	await validateScopeIds(db, domainIds, linkIds);

	const timestamp = new Date();
	await db
		.update(roles)
		.set({
			name,
			description: input.description?.trim() || null,
			permissions: serializePermissions(permissions),
			updatedAt: timestamp,
		})
		.where(eq(roles.id, id));

	await db.delete(roleDomainScopes).where(eq(roleDomainScopes.roleId, id));
	await db.delete(roleLinkScopes).where(eq(roleLinkScopes.roleId, id));

	if (domainIds.length) {
		await db.insert(roleDomainScopes).values(
			domainIds.map((domainId) => ({
				id: nanoid(),
				roleId: id,
				domainId,
				createdAt: timestamp,
			})),
		);
	}
	if (linkIds.length) {
		await db.insert(roleLinkScopes).values(
			linkIds.map((linkId) => ({
				id: nanoid(),
				roleId: id,
				linkId,
				createdAt: timestamp,
			})),
		);
	}
}

export async function deleteRole(db: AppDb, id: string) {
	const [existing] = await db
		.select()
		.from(roles)
		.where(eq(roles.id, id))
		.limit(1);
	if (!existing) {
		throw new Error("errors.roleMissing");
	}
	if (existing.isSystem) {
		throw new Error("errors.roleSystem");
	}

	const [usage] = await db
		.select({ total: count() })
		.from(user)
		.where(eq(user.roleId, id));
	if (Number(usage?.total ?? 0) > 0) {
		throw new Error("errors.roleInUse");
	}

	const [pendingInvites] = await db
		.select({ total: count() })
		.from(adminInvites)
		.where(
			and(
				eq(adminInvites.roleId, id),
				isNull(adminInvites.acceptedAt),
				gt(adminInvites.expiresAt, Date.now()),
			),
		);
	if (Number(pendingInvites?.total ?? 0) > 0) {
		throw new Error("errors.roleHasPendingInvites");
	}

	await db.delete(roles).where(eq(roles.id, id));
}

export async function listAssignableRoles(db: AppDb) {
	return db
		.select({
			id: roles.id,
			name: roles.name,
			isSystem: roles.isSystem,
		})
		.from(roles)
		.orderBy(roles.name);
}

export const SYSTEM_OWNER_ID = SYSTEM_ROLE_OWNER;
