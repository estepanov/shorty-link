import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { oauthAccessToken } from "../db/schema";

export type McpBearerSession = {
	userId: string;
};

export function extractBearerToken(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	if (!authorization) {
		return null;
	}
	const match = authorization.match(/^Bearer\s+(.+)$/i);
	const token = match?.[1]?.trim();
	return token || null;
}

function isExpired(expiresAt: Date) {
	return expiresAt.getTime() <= Date.now();
}

export async function getMcpBearerSession(
	db: AppDb,
	request: Request,
): Promise<McpBearerSession | null> {
	const token = extractBearerToken(request);
	if (!token) {
		return null;
	}

	const rows = await db
		.select({
			userId: oauthAccessToken.userId,
			accessTokenExpiresAt: oauthAccessToken.accessTokenExpiresAt,
		})
		.from(oauthAccessToken)
		.where(eq(oauthAccessToken.accessToken, token))
		.limit(1);

	const row = rows[0];
	if (!row?.userId || isExpired(row.accessTokenExpiresAt)) {
		return null;
	}

	return { userId: row.userId };
}
