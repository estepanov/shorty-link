import { type AuthContext, loadAuthContextForUser } from "../auth/session";
import type { AppDb } from "../db/client";
import { getMcpSettings } from "../services/mcp-settings";

export type McpAuthorization =
	| { status: "ok"; ctx: AuthContext }
	| { status: "disabled" }
	| { status: "unauth" }
	| { status: "denied" };

export async function authorizeMcpUser(
	db: AppDb,
	userId: string,
): Promise<McpAuthorization> {
	const settings = await getMcpSettings(db);
	if (!settings.serverEnabled) {
		return { status: "disabled" };
	}

	if (!userId) {
		return { status: "unauth" };
	}

	const ctx = await loadAuthContextForUser(userId, {
		requireMcpAccess: true,
	});
	if (!ctx) {
		return { status: "denied" };
	}

	return { status: "ok", ctx };
}

export async function authorizeMcpOAuthUser(userId: string) {
	return loadAuthContextForUser(userId, { requireMcpAccess: true });
}
