import { mkdirSync } from "node:fs";

import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "../src/server/db/redirect-event-schema-version";
import {
	analyticsAggregationState,
	redirectEventDaily,
	redirectEvents,
	schema,
	shortLinks,
} from "../src/server/db/schema";
import { aggregateAnalytics } from "../src/server/services/analytics/aggregate";
import {
	ANALYTICS_AGGREGATION_STATE_ID,
	startOfUtcDay,
	UTC_DAY_MS,
} from "../src/server/services/analytics/dimensions";
import { persistClicks } from "../src/server/services/analytics/record-click";
import {
	parseRetentionDays,
	readRetentionDays,
} from "../src/server/services/analytics/retention";
import { getLinkStats } from "../src/server/services/analytics/stats";
import { saveLink } from "../src/server/services/links";
import { applyD1Migrations } from "./apply-d1-migrations";

const dayMs = 24 * 60 * 60 * 1000;

describe("analytics rollups and retention", () => {
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

	it("does not write aggregation state when there are no new events", async () => {
		await aggregateAnalytics(db, { now: Date.now() });

		const states = await db.select().from(analyticsAggregationState);
		expect(states).toEqual([]);
	});

	it("reads raw events until the aggregator has run, then matches from rollups", async () => {
		const linkId = await saveLink(db, {
			slug: "stats",
			targetUrl: "https://example.com/stats",
		});
		const windowStart = startOfUtcDay(Date.now() - dayMs);

		await db.insert(redirectEvents).values([
			{
				id: "event-window-null",
				linkId,
				hostname: "__default__",
				slug: "stats",
				targetUrl: "https://example.com/stats",
				statusCode: 302,
				utmSource: null,
				utmMedium: "email",
				userAgentBrowser: "Chrome",
				userAgentOs: "Windows",
				userAgentDeviceType: "desktop",
				userAgentIsBot: false,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: windowStart + 1_000,
			},
			{
				id: "event-window-newsletter",
				linkId,
				hostname: "__default__",
				slug: "stats",
				targetUrl: "https://example.com/stats",
				statusCode: 302,
				utmSource: "newsletter",
				utmMedium: "email",
				userAgentBrowser: "Safari",
				userAgentOs: "iOS",
				userAgentDeviceType: "mobile",
				userAgentIsBot: false,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: windowStart + dayMs + 1_000,
			},
			{
				id: "event-old",
				linkId,
				hostname: "__default__",
				slug: "stats",
				targetUrl: "https://example.com/stats",
				statusCode: 302,
				utmSource: "old",
				utmMedium: "social",
				userAgentBrowser: "Firefox",
				userAgentOs: "Linux",
				userAgentDeviceType: "desktop",
				userAgentIsBot: false,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: windowStart - dayMs,
			},
		]);

		const rawStats = await getLinkStats(db, linkId, {
			breakdownLimit: 5,
			days: 2,
		});
		expect(rawStats.totals).toEqual({ allTime: 3, window: 2 });

		await aggregateAnalytics(db, { now: Date.now() });

		const rolled = await getLinkStats(db, linkId, {
			breakdownLimit: 5,
			days: 2,
		});
		expect(rolled.totals).toEqual(rawStats.totals);
		expect(rolled.histogram).toEqual(rawStats.histogram);
		expect(rolled.breakdowns).toEqual(rawStats.breakdowns);
		expect(rolled.userAgents).toEqual(rawStats.userAgents);
		expect(rolled.recentEvents).toHaveLength(3);
	});

	it("includes events recorded after the last aggregation in dashboard totals", async () => {
		const linkId = await saveLink(db, {
			slug: "tail",
			targetUrl: "https://example.com/tail",
		});
		const now = Date.now();

		await db.insert(redirectEvents).values({
			id: "rolled-click",
			linkId,
			hostname: "__default__",
			slug: "tail",
			targetUrl: "https://example.com/tail",
			statusCode: 302,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now - 1_000,
		});
		await aggregateAnalytics(db, { now });
		await db.insert(redirectEvents).values({
			id: "fresh-click",
			linkId,
			hostname: "__default__",
			slug: "tail",
			targetUrl: "https://example.com/tail",
			statusCode: 302,
			utmSource: "fresh",
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now,
		});

		const stats = await getLinkStats(db, linkId, {
			days: 30,
			breakdownLimit: 5,
		});
		expect(stats.totals.allTime).toBe(2);
		expect(stats.breakdowns.utmSource).toEqual([{ value: "fresh", total: 1 }]);
	});

	it("matches a single run when events are folded in created_at chunks", async () => {
		const linkId = await saveLink(db, {
			slug: "chunk",
			targetUrl: "https://example.com/chunk",
		});
		const now = Date.now();

		await db.insert(redirectEvents).values([
			{
				id: "chunk-a",
				linkId,
				hostname: "__default__",
				slug: "chunk",
				targetUrl: "https://example.com/chunk",
				statusCode: 302,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: now - 3_000,
			},
			{
				id: "chunk-b",
				linkId,
				hostname: "__default__",
				slug: "chunk",
				targetUrl: "https://example.com/chunk",
				statusCode: 302,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: now - 2_000,
			},
			{
				id: "chunk-c",
				linkId,
				hostname: "__default__",
				slug: "chunk",
				targetUrl: "https://example.com/chunk",
				statusCode: 302,
				eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
				createdAt: now - 1_000,
			},
		]);

		await aggregateAnalytics(db, { now, batchSize: 1 });

		const stats = await getLinkStats(db, linkId, { days: 30 });
		expect(stats.totals.allTime).toBe(3);
	});

	it("increments rollups for new events only and retains rolled-up raw rows", async () => {
		const linkId = await saveLink(db, {
			slug: "retain",
			targetUrl: "https://example.com/retain",
		});
		const now = Date.now();
		const oldDay = startOfUtcDay(now - 10 * dayMs);

		await db.insert(redirectEvents).values({
			id: "old-click",
			linkId,
			hostname: "__default__",
			slug: "retain",
			targetUrl: "https://example.com/retain",
			statusCode: 302,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: oldDay + 1_000,
		});

		await aggregateAnalytics(db, { now, retainDays: 7 });

		await db.insert(redirectEvents).values({
			id: "new-click",
			linkId,
			hostname: "__default__",
			slug: "retain",
			targetUrl: "https://example.com/retain",
			statusCode: 302,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now,
		});

		await aggregateAnalytics(db, { now, retainDays: 7 });

		const remaining = await db
			.select({ id: redirectEvents.id })
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));
		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));
		const stats = await getLinkStats(db, linkId, { days: 30 });
		const stale = await db
			.select({ id: redirectEvents.id })
			.from(redirectEvents)
			.where(lt(redirectEvents.createdAt, now - 7 * dayMs));

		expect(remaining.map((row) => row.id)).toEqual(["new-click"]);
		expect(stale).toHaveLength(0);
		expect(stats.totals.allTime).toBe(2);
		expect(link?.hitCount).toBe(2);
	});

	it("reads rollups even when aggregation state is missing", async () => {
		const linkId = await saveLink(db, {
			slug: "orphan-rollup",
			targetUrl: "https://example.com/orphan",
		});
		const day = startOfUtcDay(Date.now());
		await db.insert(redirectEventDaily).values({
			linkId,
			day,
			total: 4,
		});

		const stats = await getLinkStats(db, linkId, { days: 30 });
		expect(stats.totals.allTime).toBe(4);
		expect(stats.totals.window).toBe(4);
	});

	it("still counts a late event whose createdAt is behind the last watermark", async () => {
		const linkId = await saveLink(db, {
			slug: "late",
			targetUrl: "https://example.com/late",
		});
		const now = Date.now();

		await db.insert(redirectEvents).values({
			id: "on-time",
			linkId,
			hostname: "__default__",
			slug: "late",
			targetUrl: "https://example.com/late",
			statusCode: 302,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now,
		});
		await aggregateAnalytics(db, { now });
		await db.insert(redirectEvents).values({
			id: "late-arrival",
			linkId,
			hostname: "__default__",
			slug: "late",
			targetUrl: "https://example.com/late",
			statusCode: 302,
			utmSource: "late",
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now - 5_000,
		});

		const before = await getLinkStats(db, linkId, {
			days: 30,
			breakdownLimit: 5,
		});
		expect(before.totals.allTime).toBe(2);
		expect(before.breakdowns.utmSource).toEqual([{ value: "late", total: 1 }]);

		await aggregateAnalytics(db, { now, batchSize: 1 });
		const after = await getLinkStats(db, linkId, {
			days: 30,
			breakdownLimit: 5,
		});
		expect(after.totals.allTime).toBe(2);
		expect(after.breakdowns.utmSource).toEqual([{ value: "late", total: 1 }]);
	});

	it("keeps hit_count aligned with rollups after retention and a new persist", async () => {
		const linkId = await saveLink(db, {
			slug: "hits",
			targetUrl: "https://example.com/hits",
		});
		const now = Date.now();
		const oldDay = startOfUtcDay(now - 10 * dayMs);

		await persistClicks(db, [
			{
				id: "old-hit",
				linkId,
				hostname: "__default__",
				slug: "hits",
				targetUrl: "https://example.com/hits",
				statusCode: 302,
				createdAt: oldDay + 1_000,
			},
		]);
		await aggregateAnalytics(db, { now, retainDays: 7 });
		await persistClicks(db, [
			{
				id: "new-hit",
				linkId,
				hostname: "__default__",
				slug: "hits",
				targetUrl: "https://example.com/hits",
				statusCode: 302,
				createdAt: now,
			},
		]);

		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));
		const stats = await getLinkStats(db, linkId, { days: 30 });
		expect(stats.totals.allTime).toBe(2);
		expect(link?.hitCount).toBe(2);
		expect(link?.lastClickAt).toBe(now);
	});

	it("does not fold events while another run holds the aggregation lease", async () => {
		const now = Date.now();
		const linkId = await saveLink(db, {
			slug: "lease",
			targetUrl: "https://example.com/lease",
		});
		await db.insert(redirectEvents).values({
			id: "leased-click",
			linkId,
			hostname: "__default__",
			slug: "lease",
			targetUrl: "https://example.com/lease",
			statusCode: 302,
			eventSchemaVersion: REDIRECT_EVENT_SCHEMA_VERSION,
			createdAt: now,
		});
		await db.insert(analyticsAggregationState).values({
			id: ANALYTICS_AGGREGATION_STATE_ID,
			lastSuccessAt: 0,
			lockedUntil: now + 60_000,
		});

		await aggregateAnalytics(db, { now });

		const [event] = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.id, "leased-click"));
		const daily = await db.select().from(redirectEventDaily);

		expect(event?.aggregated).toBe(false);
		expect(daily).toHaveLength(0);
	});
});

describe("analytics retention config", () => {
	it("parses a positive day count and ignores unset values", () => {
		expect(parseRetentionDays(undefined)).toBeUndefined();
		expect(parseRetentionDays("")).toBeUndefined();
		expect(parseRetentionDays("0")).toBeUndefined();
		expect(parseRetentionDays("-1")).toBeUndefined();
		expect(parseRetentionDays("90")).toBe(90);
		expect(parseRetentionDays(" 14 ")).toBe(14);
		expect(parseRetentionDays(90)).toBe(90);
		expect(parseRetentionDays(0)).toBeUndefined();
		expect(readRetentionDays({})).toBeUndefined();
		expect(readRetentionDays({ ANALYTICS_RAW_EVENT_RETENTION_DAYS: 90 })).toBe(
			90,
		);
		expect(
			readRetentionDays({ ANALYTICS_RAW_EVENT_RETENTION_DAYS: "30" }),
		).toBe(30);
	});
});

describe("utc day buckets", () => {
	it("matches integer epoch-day math used in SQL", () => {
		const timestamp = 1_700_000_000_123;
		expect(startOfUtcDay(timestamp)).toBe(
			Math.trunc(timestamp / UTC_DAY_MS) * UTC_DAY_MS,
		);
	});
});
