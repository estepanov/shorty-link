import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { redirectEvents, schema, shortLinks } from "../src/server/db/schema";
import {
	getAnalyticsEngine,
	toAnalyticsEngineDataPoint,
} from "../src/server/services/analytics/engine";
import { recordClick } from "../src/server/services/analytics/record-click";
import { saveLink } from "../src/server/services/links";
import { applyD1Migrations } from "./apply-d1-migrations";

const click = {
	linkId: "link-1",
	hostname: "__default__",
	slug: "go",
	targetUrl: "https://example.com/path",
	statusCode: 302,
	country: "US",
	utmSource: "newsletter",
};

describe("analytics engine binding", () => {
	it("treats a missing or non-engine binding as absent", () => {
		expect(getAnalyticsEngine(undefined)).toBeUndefined();
		expect(getAnalyticsEngine({})).toBeUndefined();
		expect(getAnalyticsEngine({ ANALYTICS: "nope" })).toBeUndefined();
	});

	it("returns a binding that can write data points", () => {
		const engine = { writeDataPoint: () => undefined };
		expect(getAnalyticsEngine({ ANALYTICS: engine })).toBe(engine);
	});

	it("maps a click onto a stable Analytics Engine data point", () => {
		expect(toAnalyticsEngineDataPoint(click)).toEqual({
			indexes: ["link-1"],
			blobs: [
				"__default__",
				"go",
				"US",
				"",
				"",
				"",
				"",
				"newsletter",
				"",
				"",
				"",
				"",
				"https://example.com/path",
			],
			doubles: [302],
		});
	});
});

describe("analytics engine emit", () => {
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

	it("writes a data point and still persists D1 when no queue is bound", async () => {
		const linkId = await saveLink(db, {
			slug: "engine",
			targetUrl: "https://example.com/engine",
		});
		const points: unknown[] = [];

		await recordClick(
			db,
			{
				linkId,
				hostname: "__default__",
				slug: "engine",
				targetUrl: "https://example.com/engine",
				statusCode: 302,
				country: "DE",
			},
			{
				engine: {
					writeDataPoint: (point) => {
						points.push(point);
					},
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

		expect(points).toEqual([
			toAnalyticsEngineDataPoint({
				linkId,
				hostname: "__default__",
				slug: "engine",
				targetUrl: "https://example.com/engine",
				statusCode: 302,
				country: "DE",
			}),
		]);
		expect(events).toHaveLength(1);
		expect(link?.hitCount).toBe(1);
	});

	it("writes a data point and enqueues without writing D1 when a queue is bound", async () => {
		const linkId = await saveLink(db, {
			slug: "both",
			targetUrl: "https://example.com/both",
		});
		const points: unknown[] = [];
		const sent: unknown[] = [];

		await recordClick(
			db,
			{
				linkId,
				hostname: "__default__",
				slug: "both",
				targetUrl: "https://example.com/both",
				statusCode: 301,
			},
			{
				engine: {
					writeDataPoint: (point) => {
						points.push(point);
					},
				},
				queue: {
					send: async (body) => {
						sent.push(body);
					},
				},
			},
		);

		const events = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.linkId, linkId));

		expect(points).toHaveLength(1);
		expect(sent).toHaveLength(1);
		expect(events).toHaveLength(0);
	});
});
