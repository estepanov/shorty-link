import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../src/server/db/redirect-event-schema-version";
import { redirectEvents, schema, shortLinks } from "../src/server/db/schema";
import {
	ANALYTICS_QUEUE_MESSAGE_VERSION,
	consumeAnalyticsBatch,
	getAnalyticsQueue,
	parseAnalyticsQueueMessage,
	persistClicks,
	recordClick,
	toAnalyticsQueueMessage,
} from "../src/server/services/analytics/record-click";
import { saveLink } from "../src/server/services/links";
import { applyD1Migrations } from "./apply-d1-migrations";

const click = {
	linkId: "link-1",
	hostname: "__default__",
	slug: "go",
	targetUrl: "https://example.com",
	statusCode: 302,
};

describe("analytics queue message", () => {
	it("treats a missing or non-queue binding as absent", () => {
		expect(getAnalyticsQueue(undefined)).toBeUndefined();
		expect(getAnalyticsQueue({})).toBeUndefined();
		expect(getAnalyticsQueue({ ANALYTICS_QUEUE: "nope" })).toBeUndefined();
	});

	it("returns a binding that can send", () => {
		const queue = { send: async () => undefined };
		expect(getAnalyticsQueue({ ANALYTICS_QUEUE: queue })).toBe(queue);
	});

	it("round-trips a versioned click message", () => {
		const message = toAnalyticsQueueMessage(click);
		expect(message.v).toBe(ANALYTICS_QUEUE_MESSAGE_VERSION);
		expect(message).toMatchObject(click);
		expect(typeof message.id).toBe("string");
		expect(message.id.length).toBeGreaterThan(0);
		expect(Number.isFinite(message.createdAt)).toBe(true);
		expect(parseAnalyticsQueueMessage(message)).toEqual(message);
	});

	it("rejects invalid queue payloads", () => {
		expect(parseAnalyticsQueueMessage(null)).toBeNull();
		expect(
			parseAnalyticsQueueMessage({ v: 2, id: "x", createdAt: 1, click }),
		).toBeNull();
		expect(
			parseAnalyticsQueueMessage({
				v: 1,
				id: "x",
				createdAt: 1,
				...click,
				linkId: 1,
			}),
		).toBeNull();
		expect(
			parseAnalyticsQueueMessage({
				v: 1,
				id: "x",
				createdAt: 1,
				...click,
				country: 1,
			}),
		).toBeNull();
	});
});

describe("analytics persist and enqueue", () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeEach(async () => {
		mkdirSync("/tmp/wrangler-logs", { recursive: true });
		process.env.WRANGLER_LOG_PATH = "/tmp/wrangler-logs";
		process.env.WRANGLER_LOG = "error";

		proxy = await getPlatformProxy({
			configPath: "wrangler.jsonc",
			persist: false,
			remoteBindings: false,
		});
		const database = (proxy.env as { DB: D1Database }).DB;
		await applyD1Migrations(database);
		db = drizzle(database, { schema });
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("enqueues when a queue is passed and does not write D1", async () => {
		const linkId = await saveLink(db, {
			slug: "queued",
			targetUrl: "https://example.com/queued",
		});
		const sent: unknown[] = [];

		await recordClick(
			db,
			{
				linkId,
				hostname: "__default__",
				slug: "queued",
				targetUrl: "https://example.com/queued",
				statusCode: 302,
				utmSource: "newsletter",
			},
			{
				send: async (body) => {
					sent.push(body);
				},
			},
		);

		const events = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));
		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(events).toHaveLength(0);
		expect(link?.hitCount).toBe(0);
		expect(sent).toHaveLength(1);
		expect(parseAnalyticsQueueMessage(sent[0])).toMatchObject({
			v: ANALYTICS_QUEUE_MESSAGE_VERSION,
			linkId,
			slug: "queued",
			utmSource: "newsletter",
		});
	});

	it("batches persist for one link and ignores duplicate ids", async () => {
		const linkId = await saveLink(db, {
			slug: "batch",
			targetUrl: "https://example.com/batch",
		});
		const click = {
			linkId,
			hostname: "__default__",
			slug: "batch",
			targetUrl: "https://example.com/batch",
			statusCode: 302,
			utmCampaign: "spring",
		};

		await persistClicks(db, [
			{ ...click, id: "click-a", createdAt: 100 },
			{ ...click, id: "click-b", createdAt: 200 },
		]);
		await persistClicks(db, [{ ...click, id: "click-a", createdAt: 100 }]);

		const events = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));
		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(events).toHaveLength(2);
		expect(events.map((event) => event.id).sort()).toEqual([
			"click-a",
			"click-b",
		]);
		expect(events.every((event) => event.utmCampaign === "spring")).toBe(true);
		expect(
			events.every(
				(event) => event.eventSchemaVersion === REDIRECT_EVENT_SCHEMA_VERSION,
			),
		).toBe(true);
		expect(link?.hitCount).toBe(2);
		expect(link?.lastClickAt).toBe(200);
	});

	it("does not move lastClickAt backward when an older click arrives later", async () => {
		const linkId = await saveLink(db, {
			slug: "order",
			targetUrl: "https://example.com/order",
		});
		const click = {
			linkId,
			hostname: "__default__",
			slug: "order",
			targetUrl: "https://example.com/order",
			statusCode: 302,
		};

		await persistClicks(db, [{ ...click, id: "newer", createdAt: 200 }]);
		await persistClicks(db, [{ ...click, id: "older", createdAt: 50 }]);

		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(link?.hitCount).toBe(2);
		expect(link?.lastClickAt).toBe(200);
	});

	it("consumes a valid batch into the same row shape as persist", async () => {
		const linkId = await saveLink(db, {
			slug: "consume",
			targetUrl: "https://example.com/consume",
		});
		const message = toAnalyticsQueueMessage({
			linkId,
			hostname: "__default__",
			slug: "consume",
			targetUrl: "https://example.com/consume",
			statusCode: 302,
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			utmSource: "newsletter",
			utmMedium: "email",
			utmCampaign: "spring",
			utmTerm: "pricing",
			utmContent: "hero",
		});

		await consumeAnalyticsBatch(db, {
			messages: [{ body: message, retry: () => undefined }],
		});

		const [event] = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));
		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(event).toMatchObject({
			id: message.id,
			createdAt: message.createdAt,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			utmCampaign: "spring",
			utmContent: "hero",
			utmMedium: "email",
			utmSource: "newsletter",
			utmTerm: "pricing",
			userAgentBrowser: "Safari",
			userAgentDeviceType: "mobile",
			userAgentIsBot: false,
			userAgentOs: "iOS",
		});
		expect(link?.hitCount).toBe(1);
		expect(link?.lastClickAt).toBe(message.createdAt);
	});

	it("retries invalid messages and is idempotent on replay", async () => {
		const linkId = await saveLink(db, {
			slug: "retry",
			targetUrl: "https://example.com/retry",
		});
		const message = toAnalyticsQueueMessage({
			linkId,
			hostname: "__default__",
			slug: "retry",
			targetUrl: "https://example.com/retry",
			statusCode: 302,
		});
		const retried: unknown[] = [];

		await consumeAnalyticsBatch(db, {
			messages: [
				{ body: message, retry: () => undefined },
				{
					body: { v: 2, id: "bad", createdAt: 1, click: {} },
					retry: () => {
						retried.push("bad");
					},
				},
			],
		});
		await consumeAnalyticsBatch(db, {
			messages: [{ body: message, retry: () => undefined }],
		});

		const events = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));
		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(retried).toEqual(["bad"]);
		expect(events).toHaveLength(1);
		expect(link?.hitCount).toBe(1);
	});
});
