export const PERMISSIONS = [
	"links.read",
	"links.write",
	"links.delete",
	"domains.read",
	"domains.write",
	"domains.delete",
	"users.read",
	"users.write",
	"users.delete",
	"invites.manage",
	"sessions.manage",
	"apikeys.manage",
	"roles.manage",
	"analytics.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: Record<string, readonly Permission[]> = {
	links: ["links.read", "links.write", "links.delete"],
	domains: ["domains.read", "domains.write", "domains.delete"],
	users: ["users.read", "users.write", "users.delete"],
	access: [
		"invites.manage",
		"sessions.manage",
		"apikeys.manage",
		"roles.manage",
	],
	analytics: ["analytics.read"],
};

export function isPermission(value: unknown): value is Permission {
	return (
		typeof value === "string" &&
		(PERMISSIONS as readonly string[]).includes(value)
	);
}

export function parsePermissions(
	value: string | null | undefined,
): Set<Permission> {
	if (!value) {
		return new Set();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return new Set();
	}
	if (!Array.isArray(parsed)) {
		return new Set();
	}
	const result = new Set<Permission>();
	for (const item of parsed) {
		if (isPermission(item)) {
			result.add(item);
		}
	}
	return result;
}

export function serializePermissions(value: Iterable<Permission>): string {
	const unique = new Set<Permission>();
	for (const item of value) {
		if (isPermission(item)) {
			unique.add(item);
		}
	}
	return JSON.stringify(
		PERMISSIONS.filter((permission) => unique.has(permission)),
	);
}

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;
