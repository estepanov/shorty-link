import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { oauthAccessToken, oauthApplication, oauthConsent } from "../db/schema";

export type McpGrant = {
	id: string;
	clientId: string;
	clientName: string;
	scopes: string[];
	createdAt: Date;
	updatedAt: Date;
};

function parseScopes(value: string) {
	return value
		.split(/[,\s]+/)
		.map((scope) => scope.trim())
		.filter(Boolean);
}

export async function listMcpGrants(
	db: AppDb,
	userId: string,
): Promise<McpGrant[]> {
	const rows = await db
		.select({
			id: oauthConsent.id,
			clientId: oauthConsent.clientId,
			clientName: oauthApplication.name,
			scopes: oauthConsent.scopes,
			createdAt: oauthConsent.createdAt,
			updatedAt: oauthConsent.updatedAt,
		})
		.from(oauthConsent)
		.leftJoin(
			oauthApplication,
			eq(oauthConsent.clientId, oauthApplication.clientId),
		)
		.where(
			and(eq(oauthConsent.userId, userId), eq(oauthConsent.consentGiven, true)),
		)
		.orderBy(desc(oauthConsent.updatedAt));

	return rows.map((row) => ({
		id: row.id,
		clientId: row.clientId,
		clientName: row.clientName?.trim() || row.clientId,
		scopes: parseScopes(row.scopes),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
}

export async function revokeMcpGrant(
	db: AppDb,
	userId: string,
	grantId: string,
) {
	const rows = await db
		.select({
			id: oauthConsent.id,
			clientId: oauthConsent.clientId,
		})
		.from(oauthConsent)
		.where(and(eq(oauthConsent.id, grantId), eq(oauthConsent.userId, userId)))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new Error("errors.mcpGrantMissing");
	}

	await db
		.delete(oauthAccessToken)
		.where(
			and(
				eq(oauthAccessToken.userId, userId),
				eq(oauthAccessToken.clientId, row.clientId),
			),
		);
	await db
		.delete(oauthConsent)
		.where(and(eq(oauthConsent.id, grantId), eq(oauthConsent.userId, userId)));
}
