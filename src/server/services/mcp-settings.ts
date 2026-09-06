import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import {
	appSettings,
	MCP_SETTING_ENABLED,
	oauthAccessToken,
	oauthConsent,
	user,
} from "../db/schema";

export type McpSettings = {
	serverEnabled: boolean;
};

export async function getMcpSettings(db: AppDb): Promise<McpSettings> {
	const rows = await db
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, MCP_SETTING_ENABLED))
		.limit(1);
	return { serverEnabled: rows[0]?.value === "true" };
}

export async function setMcpServerEnabled(db: AppDb, enabled: boolean) {
	const now = new Date();
	await db
		.insert(appSettings)
		.values({
			key: MCP_SETTING_ENABLED,
			value: enabled ? "true" : "false",
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: appSettings.key,
			set: {
				value: enabled ? "true" : "false",
				updatedAt: now,
			},
		});
}

export async function getUserMcpAccess(db: AppDb, userId: string) {
	const rows = await db
		.select({
			isActive: user.isActive,
			mcpAccessEnabled: user.mcpAccessEnabled,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return { exists: false as const, allowed: false };
	}
	return {
		exists: true as const,
		allowed: row.isActive !== false && row.mcpAccessEnabled !== false,
	};
}

export async function revokeUserMcpTokens(db: AppDb, userId: string) {
	await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
	await db.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
}

export async function setUserMcpAccess(
	db: AppDb,
	userId: string,
	mcpAccessEnabled: boolean,
) {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!rows[0]) {
		throw new Error("errors.userMissing");
	}

	await db
		.update(user)
		.set({ mcpAccessEnabled, updatedAt: new Date() })
		.where(eq(user.id, userId));

	if (!mcpAccessEnabled) {
		await revokeUserMcpTokens(db, userId);
	}
}

export async function assertMcpServerEnabled(db: AppDb) {
	const settings = await getMcpSettings(db);
	if (!settings.serverEnabled) {
		throw new Error("errors.mcpDisabled");
	}
}

export async function assertMcpUserAllowed(db: AppDb, userId: string) {
	const access = await getUserMcpAccess(db, userId);
	if (!access.exists || !access.allowed) {
		throw new Error("errors.mcpAccessDenied");
	}
}
