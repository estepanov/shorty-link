import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AppDb } from "../../db/client";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../../db/redirect-event-schema-version";
import { redirectEvents, shortLinks } from "../../db/schema";
import { parseRedirectUserAgent } from "../user-agent";
import { CLICK_FIELD_LIMITS, truncateStoredText } from "./click-fields";
import {
	type AnalyticsEngineWriter,
	getAnalyticsEngine,
	toAnalyticsEngineDataPoint,
} from "./engine";

export const ANALYTICS_QUEUE_MESSAGE_VERSION = 1 as const;

const OPTIONAL_CLICK_KEYS = [
	"country",
	"city",
	"colo",
	"referer",
	"userAgent",
	"ipHash",
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmTerm",
	"utmContent",
] as const;

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

export type StampedClick = RecordClickInput & {
	id: string;
	createdAt: number;
};

export type AnalyticsQueueMessage = {
	v: typeof ANALYTICS_QUEUE_MESSAGE_VERSION;
} & StampedClick;

export type AnalyticsQueueSender = {
	send(message: AnalyticsQueueMessage): Promise<unknown>;
};

export type AnalyticsQueueBatch = {
	messages: readonly {
		body: unknown;
		retry: () => void;
	}[];
};

export type AnalyticsSinks = {
	queue?: AnalyticsQueueSender;
	engine?: AnalyticsEngineWriter;
};

type AnalyticsQueueBindings = {
	ANALYTICS_QUEUE?: unknown;
};

function isQueueSender(value: unknown): value is AnalyticsQueueSender {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as AnalyticsQueueSender).send === "function"
	);
}

export function getAnalyticsQueue(
	bindings: object | undefined,
): AnalyticsQueueSender | undefined {
	if (!bindings || !("ANALYTICS_QUEUE" in bindings)) {
		return undefined;
	}

	const queue = (bindings as AnalyticsQueueBindings).ANALYTICS_QUEUE;
	return isQueueSender(queue) ? queue : undefined;
}

function defaultAnalyticsSinks(): AnalyticsSinks {
	return {
		queue: getAnalyticsQueue(env),
		engine: getAnalyticsEngine(env),
	};
}

export function stampClick(input: RecordClickInput): StampedClick {
	return {
		...input,
		id: nanoid(),
		createdAt: Date.now(),
	};
}

export function toAnalyticsQueueMessage(
	input: RecordClickInput,
): AnalyticsQueueMessage {
	return {
		v: ANALYTICS_QUEUE_MESSAGE_VERSION,
		...stampClick(input),
	};
}

function readOptionalText(value: unknown): string | null | undefined | false {
	if (value === undefined || value === null || typeof value === "string") {
		return value;
	}
	return false;
}

function parseStampedClick(value: unknown): StampedClick | null {
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
		!Number.isFinite(click.statusCode) ||
		typeof click.id !== "string" ||
		click.id.length === 0 ||
		typeof click.createdAt !== "number" ||
		!Number.isFinite(click.createdAt)
	) {
		return null;
	}

	const optional: Partial<RecordClickInput> = {};
	for (const key of OPTIONAL_CLICK_KEYS) {
		const parsed = readOptionalText(click[key]);
		if (parsed === false) {
			return null;
		}
		optional[key] = parsed;
	}

	return {
		id: click.id,
		createdAt: click.createdAt,
		linkId: click.linkId,
		hostname: click.hostname,
		slug: click.slug,
		targetUrl: click.targetUrl,
		statusCode: click.statusCode,
		...optional,
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

	const click = parseStampedClick(message);
	if (!click) {
		return null;
	}

	return {
		v: ANALYTICS_QUEUE_MESSAGE_VERSION,
		...click,
	};
}

function toEventRow(input: StampedClick) {
	const userAgent = truncateStoredText(
		input.userAgent,
		CLICK_FIELD_LIMITS.userAgent,
	);
	const parsedUserAgent = parseRedirectUserAgent(userAgent);

	return {
		id: input.id,
		linkId: input.linkId,
		hostname: input.hostname,
		slug: input.slug,
		targetUrl: input.targetUrl,
		statusCode: input.statusCode,
		eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
		country: truncateStoredText(input.country, CLICK_FIELD_LIMITS.country),
		city: truncateStoredText(input.city, CLICK_FIELD_LIMITS.city),
		colo: truncateStoredText(input.colo, CLICK_FIELD_LIMITS.colo),
		referer: truncateStoredText(input.referer, CLICK_FIELD_LIMITS.referer),
		userAgent,
		userAgentBrowser: parsedUserAgent.browser,
		userAgentOs: parsedUserAgent.os,
		userAgentDeviceType: parsedUserAgent.deviceType,
		userAgentIsBot: parsedUserAgent.isBot,
		ipHash: input.ipHash ?? null,
		utmSource: truncateStoredText(
			input.utmSource,
			CLICK_FIELD_LIMITS.utmSource,
		),
		utmMedium: truncateStoredText(
			input.utmMedium,
			CLICK_FIELD_LIMITS.utmMedium,
		),
		utmCampaign: truncateStoredText(
			input.utmCampaign,
			CLICK_FIELD_LIMITS.utmCampaign,
		),
		utmTerm: truncateStoredText(input.utmTerm, CLICK_FIELD_LIMITS.utmTerm),
		utmContent: truncateStoredText(
			input.utmContent,
			CLICK_FIELD_LIMITS.utmContent,
		),
		aggregated: false,
		createdAt: input.createdAt,
	};
}

function linkHitCountSql(linkId: string) {
	return sql`(
		coalesce((select sum(total) from redirect_event_daily where link_id = ${linkId}), 0)
		+ (select count(*) from redirect_event where link_id = ${linkId} and aggregated = 0)
	)`;
}

function linkLastClickSql(linkId: string) {
	return sql`max(
		coalesce(${shortLinks.lastClickAt}, 0),
		coalesce((select max(created_at) from redirect_event where link_id = ${linkId}), 0)
	)`;
}

/**
 * Writes click rows to `redirect_event` and recounts `short_link` hit metadata
 * from those rows so queue retries stay idempotent.
 */
export async function persistClicks(
	db: AppDb,
	inputs: readonly StampedClick[],
) {
	if (inputs.length === 0) {
		return;
	}

	const rows = inputs.map(toEventRow);
	const linkIds = [...new Set(rows.map((row) => row.linkId))];
	await db.batch([
		db.insert(redirectEvents).values(rows).onConflictDoNothing(),
		...linkIds.map((linkId) =>
			db
				.update(shortLinks)
				.set({
					hitCount: linkHitCountSql(linkId),
					lastClickAt: linkLastClickSql(linkId),
					updatedAt: linkLastClickSql(linkId),
				})
				.where(eq(shortLinks.id, linkId)),
		),
	]);
}

async function writeDurableClick(
	db: AppDb,
	input: RecordClickInput,
	queue: AnalyticsQueueSender | undefined,
) {
	if (queue) {
		await queue.send(toAnalyticsQueueMessage(input));
		return;
	}

	await persistClicks(db, [stampClick(input)]);
}

/**
 * Records a click by writing an optional Analytics Engine data point, then
 * enqueueing when `ANALYTICS_QUEUE` is bound, otherwise writing D1 directly.
 * Must run inside `waitUntil` on the redirect path.
 */
export async function recordClick(
	db: AppDb,
	input: RecordClickInput,
	sinks: AnalyticsSinks = defaultAnalyticsSinks(),
) {
	if (sinks.engine) {
		sinks.engine.writeDataPoint(toAnalyticsEngineDataPoint(input));
	}

	await writeDurableClick(db, input, sinks.queue);
}

/**
 * Persists valid queued click messages and retries unparseable ones so
 * Cloudflare can dead-letter them after max_retries.
 */
export async function consumeAnalyticsBatch(
	db: AppDb,
	batch: AnalyticsQueueBatch,
) {
	const valid: StampedClick[] = [];
	for (const message of batch.messages) {
		const parsed = parseAnalyticsQueueMessage(message.body);
		if (!parsed) {
			message.retry();
			continue;
		}
		valid.push(parsed);
	}

	await persistClicks(db, valid);
}
