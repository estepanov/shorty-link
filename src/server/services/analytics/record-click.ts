import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AppDb } from "../../db/client";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../../db/redirect-event-schema-version";
import { redirectEvents, shortLinks } from "../../db/schema";
import { parseRedirectUserAgent } from "../user-agent";

/**
 * Fields required to record one redirect click for analytics. Matches the data the
 * redirect handler already collects; `recordClick` normalizes and persists it.
 *
 * Callers should pass `targetUrl` from `buildAnalyticsTarget` and UTM fields from
 * `extractUtmParams` (both in `src/server/services/links.ts`). That way only UTM query
 * params from the incoming request are merged when the link preserves query params;
 * non-UTM request params are never copied into the stored analytics URL.
 */
export type RecordClickInput = {
	linkId: string;
	hostname: string;
	slug: string;
	/** Analytics target URL (UTM-safe query merge only). */
	targetUrl: string;
	statusCode: number;
	country?: string | null;
	city?: string | null;
	colo?: string | null;
	referer?: string | null;
	userAgent?: string | null;
	ipHash?: string | null;
	utmSource?: string | null;
	utmMedium?: string | null;
	utmCampaign?: string | null;
	utmTerm?: string | null;
	utmContent?: string | null;
};

function truncateStoredText(
	value: string | null | undefined,
	maxLength: number,
) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}

/**
 * Persists a click to `redirect_event` and bumps `short_link` hit metadata.
 * Must run inside `waitUntil` on the redirect path so the response is never blocked.
 */
export async function recordClick(db: AppDb, input: RecordClickInput) {
	const timestamp = Date.now();
	const userAgent = truncateStoredText(input.userAgent, 512);
	const parsedUserAgent = parseRedirectUserAgent(userAgent);

	await db.insert(redirectEvents).values({
		id: nanoid(),
		linkId: input.linkId,
		hostname: input.hostname,
		slug: input.slug,
		targetUrl: input.targetUrl,
		statusCode: input.statusCode,
		eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
		country: truncateStoredText(input.country, 32),
		city: truncateStoredText(input.city, 128),
		colo: truncateStoredText(input.colo, 32),
		referer: truncateStoredText(input.referer, 2048),
		userAgent,
		userAgentBrowser: parsedUserAgent.browser,
		userAgentOs: parsedUserAgent.os,
		userAgentDeviceType: parsedUserAgent.deviceType,
		userAgentIsBot: parsedUserAgent.isBot,
		ipHash: input.ipHash ?? null,
		utmSource: truncateStoredText(input.utmSource, 256),
		utmMedium: truncateStoredText(input.utmMedium, 256),
		utmCampaign: truncateStoredText(input.utmCampaign, 256),
		utmTerm: truncateStoredText(input.utmTerm, 256),
		utmContent: truncateStoredText(input.utmContent, 256),
		createdAt: timestamp,
	});

	await db
		.update(shortLinks)
		.set({
			hitCount: sql`${shortLinks.hitCount} + 1`,
			lastClickAt: timestamp,
			updatedAt: timestamp,
		})
		.where(eq(shortLinks.id, input.linkId));
}
