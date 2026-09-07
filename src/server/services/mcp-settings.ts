import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { appSettings, MCP_SETTING_ENABLED, user } from "../db/schema";

export type McpSettings = {
	serverEnabled: boolean;
};

export function mcpPublicUrls(origin: string) {
	return {
		mcpUrl: `${origin}/mcp`,
		authorizationServerUrl: `${origin}/.well-known/oauth-authorization-server`,
		protectedResourceUrl: `${origin}/.well-known/oauth-protected-resource`,
	};
}

export function toMcpSettingsResponse(settings: McpSettings, origin: string) {
	return {
		enabled: settings.serverEnabled,
		...mcpPublicUrls(origin),
	};
}

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
