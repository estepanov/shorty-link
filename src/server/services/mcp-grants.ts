import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import {
	oauthAccessToken,
	oauthApplication,
	oauthConsent,
	verification,
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

export async function revokeUserMcpTokens(db: AppDb, userId: string) {
	await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
	await db.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
}

export async function getMcpConsentPrompt(
	db: AppDb,
	userId: string,
	consentCode: string,
): Promise<McpConsentPrompt> {
	const code = consentCode.trim();
	if (!code) {
		throw new Error("errors.mcpConsentMissing");
	}

	const rows = await db
		.select({
			value: verification.value,
			expiresAt: verification.expiresAt,
		})
		.from(verification)
		.where(eq(verification.identifier, code))
		.limit(1);
	const row = rows[0];
	if (!row || row.expiresAt.getTime() <= Date.now()) {
		throw new Error("errors.mcpConsentMissing");
	}

	let parsed: { clientId?: unknown; scope?: unknown; userId?: unknown };
	try {
		parsed = JSON.parse(row.value) as {
			clientId?: unknown;
			scope?: unknown;
			userId?: unknown;
		};
	} catch {
		throw new Error("errors.mcpConsentMissing");
	}

	if (parsed.userId !== userId || typeof parsed.clientId !== "string") {
		throw new Error("errors.mcpConsentMissing");
	}

	const scopes = Array.isArray(parsed.scope)
		? parsed.scope.filter((scope): scope is string => typeof scope === "string")
		: typeof parsed.scope === "string"
			? parseScopes(parsed.scope)
			: [];

	const clients = await db
		.select({ name: oauthApplication.name })
		.from(oauthApplication)
		.where(eq(oauthApplication.clientId, parsed.clientId))
		.limit(1);

	return {
		clientId: parsed.clientId,
		clientName: clients[0]?.name?.trim() || parsed.clientId,
		scopes,
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
		.delete(oauthConsent)
		.where(and(eq(oauthConsent.id, grantId), eq(oauthConsent.userId, userId)));
}
