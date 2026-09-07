import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import {
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
} from "../db/schema";

export type McpConsentPrompt = {
	clientId: string;
	clientName: string;
	scopes: string[];
};

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
			clientName: oauthClient.name,
			scopes: oauthConsent.scopes,
			createdAt: oauthConsent.createdAt,
			updatedAt: oauthConsent.updatedAt,
		})
		.from(oauthConsent)
		.leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
		.where(eq(oauthConsent.userId, userId))
		.orderBy(desc(oauthConsent.updatedAt));

	return rows.map((row) => ({
		id: row.id,
		clientId: row.clientId,
		clientName: row.clientName?.trim() || row.clientId,
		scopes: row.scopes,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
}

export async function revokeUserMcpTokens(db: AppDb, userId: string) {
	await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
	await db
		.delete(oauthRefreshToken)
		.where(eq(oauthRefreshToken.userId, userId));
	await db.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
}

export async function getMcpConsentPrompt(
	db: AppDb,
	clientId: string,
	scope: string | undefined,
): Promise<McpConsentPrompt> {
	const normalizedClientId = clientId.trim();
	if (!normalizedClientId) {
		throw new Error("errors.mcpConsentMissing");
	}

	const clients = await db
		.select({ name: oauthClient.name })
		.from(oauthClient)
		.where(eq(oauthClient.clientId, normalizedClientId))
		.limit(1);
	if (!clients[0]) {
		throw new Error("errors.mcpConsentMissing");
	}

	return {
		clientId: normalizedClientId,
		clientName: clients[0].name?.trim() || normalizedClientId,
		scopes: parseScopes(scope ?? ""),
	};
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
		.delete(oauthRefreshToken)
		.where(
			and(
				eq(oauthRefreshToken.userId, userId),
				eq(oauthRefreshToken.clientId, row.clientId),
			),
		);
	await db
		.delete(oauthConsent)
		.where(and(eq(oauthConsent.id, grantId), eq(oauthConsent.userId, userId)));
}
