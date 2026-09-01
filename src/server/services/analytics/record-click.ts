import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AppDb } from "../../db/client";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../../db/redirect-event-schema-version";
import { redirectEvents, shortLinks } from "../../db/schema";
import { parseRedirectUserAgent } from "../user-agent";

export const ANALYTICS_QUEUE_MESSAGE_VERSION = 1 as const;

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

export type PersistClickInput = RecordClickInput & {
	id?: string;
	createdAt?: number;
};

export type AnalyticsQueueMessage = {
	v: typeof ANALYTICS_QUEUE_MESSAGE_VERSION;
	id: string;
	createdAt: number;
	click: RecordClickInput;
};

export function getAnalyticsQueue(
	bindings: unknown,
): Queue<AnalyticsQueueMessage> | undefined {
	if (typeof bindings !== "object" || bindings === null) {
		return undefined;
	}

	const queue = (bindings as { ANALYTICS_QUEUE?: unknown }).ANALYTICS_QUEUE;
	if (typeof queue !== "object" || queue === null) {
		return undefined;
	}
	if (typeof (queue as { send?: unknown }).send !== "function") {
		return undefined;
	}

	return queue as Queue<AnalyticsQueueMessage>;
}

export function toAnalyticsQueueMessage(
	input: RecordClickInput,
): AnalyticsQueueMessage {
	return {
		v: ANALYTICS_QUEUE_MESSAGE_VERSION,
		id: nanoid(),
		createdAt: Date.now(),
		click: input,
	};
}

function optionalText(value: unknown): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || typeof value === "string") {
		return value;
	}
	return null;
}

function parseClick(value: unknown): RecordClickInput | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const click = value as Record<string, unknown>;
	if (
		typeof click.linkId !== "string" ||
		typeof click.hostname !== "string" ||
		typeof click.slug !== "string" ||
		typeof click.targetUrl !== "string" ||
		typeof click.statusCode !== "number" ||
		!Number.isFinite(click.statusCode)
	) {
		return null;
	}

	return {
		linkId: click.linkId,
		hostname: click.hostname,
		slug: click.slug,
		targetUrl: click.targetUrl,
		statusCode: click.statusCode,
		country: optionalText(click.country),
		city: optionalText(click.city),
		colo: optionalText(click.colo),
		referer: optionalText(click.referer),
		userAgent: optionalText(click.userAgent),
		ipHash: optionalText(click.ipHash),
		utmSource: optionalText(click.utmSource),
		utmMedium: optionalText(click.utmMedium),
		utmCampaign: optionalText(click.utmCampaign),
		utmTerm: optionalText(click.utmTerm),
		utmContent: optionalText(click.utmContent),
	};
}

export function parseAnalyticsQueueMessage(
	body: unknown,
): AnalyticsQueueMessage | null {
	if (typeof body !== "object" || body === null) {
		return null;
	}

	const message = body as Record<string, unknown>;
	if (message.v !== ANALYTICS_QUEUE_MESSAGE_VERSION) {
		return null;
	}
	if (typeof message.id !== "string" || message.id.length === 0) {
		return null;
	}
	if (
		typeof message.createdAt !== "number" ||
		!Number.isFinite(message.createdAt)
	) {
		return null;
	}

	const click = parseClick(message.click);
	if (!click) {
		return null;
	}

	return {
		v: ANALYTICS_QUEUE_MESSAGE_VERSION,
		id: message.id,
		createdAt: message.createdAt,
		click,
	};
}

function truncateStoredText(
	value: string | null | undefined,
	maxLength: number,
) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}

function toEventRow(input: PersistClickInput) {
	const timestamp = input.createdAt ?? Date.now();
	const userAgent = truncateStoredText(input.userAgent, 512);
	const parsedUserAgent = parseRedirectUserAgent(userAgent);

	return {
		id: input.id ?? nanoid(),
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
	};
}

/**
 * Writes click rows to `redirect_event` and bumps `short_link` hit metadata for
 * newly inserted ids only. Shared by the direct path and the queue consumer.
 */
export async function persistClicks(
	db: AppDb,
	inputs: readonly PersistClickInput[],
) {
	if (inputs.length === 0) {
		return;
	}

	const rows = inputs.map(toEventRow);
	const inserted = await db
		.insert(redirectEvents)
		.values(rows)
		.onConflictDoNothing()
		.returning({
			id: redirectEvents.id,
			linkId: redirectEvents.linkId,
			createdAt: redirectEvents.createdAt,
		});

	if (inserted.length === 0) {
		return;
	}

	const byLink = new Map<string, { count: number; lastClickAt: number }>();
	for (const row of inserted) {
		const current = byLink.get(row.linkId);
		if (!current) {
			byLink.set(row.linkId, { count: 1, lastClickAt: row.createdAt });
			continue;
		}
		current.count += 1;
		current.lastClickAt = Math.max(current.lastClickAt, row.createdAt);
	}

	for (const [linkId, { count, lastClickAt }] of byLink) {
		await db
			.update(shortLinks)
			.set({
				hitCount: sql`${shortLinks.hitCount} + ${count}`,
				lastClickAt,
				updatedAt: lastClickAt,
			})
			.where(eq(shortLinks.id, linkId));
	}
}

/**
 * Records a click by enqueueing when `ANALYTICS_QUEUE` is bound, otherwise
 * writing D1 directly. Must run inside `waitUntil` on the redirect path.
 */
export async function recordClick(
	db: AppDb,
	input: RecordClickInput,
	queue: Queue<AnalyticsQueueMessage> | undefined = getAnalyticsQueue(env),
) {
	if (queue) {
		await queue.send(toAnalyticsQueueMessage(input));
		return;
	}

	await persistClicks(db, [input]);
}
