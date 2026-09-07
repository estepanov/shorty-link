import { type AuthContext, loadAuthContextForUser } from "../auth/session";
import type { AppDb } from "../db/client";
import { getMcpSettings } from "../services/mcp-settings";
import { getMcpBearerSession } from "./session";

export type McpAuthorization =
	| { status: "ok"; ctx: AuthContext }
	| { status: "disabled" }
	| { status: "unauth" }
	| { status: "denied" };

export async function authorizeMcpBearer(
	db: AppDb,
	request: Request,
): Promise<McpAuthorization> {
	const settings = await getMcpSettings(db);
	if (!settings.serverEnabled) {
		return { status: "disabled" };
	}

	const session = await getMcpBearerSession(db, request);
	if (!session?.userId) {
		return { status: "unauth" };
	}

	const ctx = await loadAuthContextForUser(session.userId, {
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
