import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AppDb } from "../../db/client";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../../db/redirect-event-schema-version";
import { redirectEvents, shortLinks } from "../../db/schema";
import { parseRedirectUserAgent } from "../user-agent";
import { normalizeClickFields, type RecordClickInput } from "./click-fields";
import { updateLinkHitMetadata } from "./counts";
import {
	type AnalyticsEngineWriter,
	getAnalyticsEngine,
	toAnalyticsEngineDataPoint,
} from "./engine";

export type { RecordClickInput };

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
		click.linkId.length === 0 ||
		typeof click.hostname !== "string" ||
		click.hostname.length === 0 ||
		typeof click.slug !== "string" ||
		click.slug.length === 0 ||
		typeof click.targetUrl !== "string" ||
		click.targetUrl.length === 0 ||
		typeof click.statusCode !== "number" ||
		!Number.isInteger(click.statusCode) ||
		click.statusCode < 100 ||
		click.statusCode > 599 ||
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
	const fields = normalizeClickFields(input);
	const parsedUserAgent = parseRedirectUserAgent(fields.userAgent);

	return {
		id: input.id,
		linkId: input.linkId,
		hostname: input.hostname,
		slug: input.slug,
		targetUrl: input.targetUrl,
		statusCode: input.statusCode,
		eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
		country: fields.country,
		city: fields.city,
		colo: fields.colo,
		referer: fields.referer,
		userAgent: fields.userAgent,
		userAgentBrowser: parsedUserAgent.browser,
		userAgentOs: parsedUserAgent.os,
		userAgentDeviceType: parsedUserAgent.deviceType,
		userAgentIsBot: parsedUserAgent.isBot,
		ipHash: fields.ipHash,
		utmSource: fields.utmSource,
		utmMedium: fields.utmMedium,
		utmCampaign: fields.utmCampaign,
		utmTerm: fields.utmTerm,
		utmContent: fields.utmContent,
		aggregated: false,
		createdAt: input.createdAt,
	};
}

function isForeignKeyError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return /FOREIGN KEY/i.test(message);
}

async function existingLinkIds(db: AppDb, linkIds: readonly string[]) {
	if (linkIds.length === 0) {
		return new Set<string>();
	}

	const rows = await db
		.select({ id: shortLinks.id })
		.from(shortLinks)
		.where(inArray(shortLinks.id, [...new Set(linkIds)]));
	return new Set(rows.map((row) => row.id));
}

/**
 * Writes click rows to `redirect_event` and recounts `short_link` hit metadata
 * from those rows so queue retries stay idempotent. Clicks for missing links
 * are skipped so a deleted link cannot fail the rest of a batch.
 */
export async function persistClicks(
	db: AppDb,
	inputs: readonly StampedClick[],
) {
	if (inputs.length === 0) {
		return;
	}

	const existing = await existingLinkIds(
		db,
		inputs.map((input) => input.linkId),
	);
	const live = inputs.filter((input) => existing.has(input.linkId));
	if (live.length === 0) {
		return;
	}

	const rows = live.map(toEventRow);
	const linkIds = [...new Set(rows.map((row) => row.linkId))];
	try {
		await db.batch([
			db.insert(redirectEvents).values(rows).onConflictDoNothing(),
			...linkIds.map((linkId) => updateLinkHitMetadata(db, linkId)),
		]);
	} catch (error) {
		if (live.length === 1) {
			if (isForeignKeyError(error)) {
				return;
			}
			throw error;
		}

		for (const input of live) {
			await persistClicks(db, [input]);
		}
	}
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
 * Records a click by writing D1 or enqueueing first, then emitting an optional
 * Analytics Engine data point so AE does not outrun the durable path.
 * Must run inside `waitUntil` on the redirect path.
 */
export async function recordClick(
	db: AppDb,
	input: RecordClickInput,
	sinks: AnalyticsSinks = defaultAnalyticsSinks(),
) {
	await writeDurableClick(db, input, sinks.queue);

	if (sinks.engine) {
		sinks.engine.writeDataPoint(toAnalyticsEngineDataPoint(input));
	}
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
