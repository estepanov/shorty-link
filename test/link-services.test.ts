import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { redirectEvents, schema, shortLinks } from "../src/server/db/schema";
import {
	getLinkStats,
	getManagedDomainByHostname,
	listShortLinks,
	recordRedirectEvent,
	resolveExactRedirect,
	saveDomain,
	saveLink,
} from "../src/server/services/links";

const dayMs = 24 * 60 * 60 * 1000;

function startOfUtcDay(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}

async function applyMigrations(database: D1Database) {
	for (const file of [
		"0000_fresh_shorty_link.sql",
		"0001_redirect_event_utm.sql",
		"0002_short_link_last_click.sql",
		"0005_managed_domain_fallbacks.sql",
		"0008_redirect_event_user_agent_dimensions.sql",
	]) {
		const statements = readFileSync(
			join(process.cwd(), "migrations", file),
			"utf8",
		)
			.split(";")
			.map((statement) => statement.trim())
			.filter(Boolean);
		for (const statement of statements) {
			await database.prepare(statement).run();
		}
	}
}

describe("link services", () => {
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
		await applyMigrations(database);
		db = drizzle(database, { schema });
	});

	afterEach(async () => {
		await proxy?.dispose();
		proxy = null;
	});

	it("treats percent and underscore as literal search characters", async () => {
		const percentId = await saveLink(db, {
			slug: "percent",
			targetUrl: "https://example.com/percent",
			title: "100% real",
		});
		await saveLink(db, {
			slug: "plain",
			targetUrl: "https://example.com/plain",
			title: "1000 real",
		});

		const percentMatches = await listShortLinks(db, { search: "100%" });
		expect(percentMatches.items.map((item) => item.id)).toEqual([percentId]);

		const underscoreId = await saveLink(db, {
			slug: "sale_2026",
			targetUrl: "https://example.com/underscore",
		});
		await saveLink(db, {
			slug: "salex2026",
			targetUrl: "https://example.com/no-underscore",
		});

		const underscoreMatches = await listShortLinks(db, { search: "sale_" });
		expect(underscoreMatches.items.map((item) => item.id)).toEqual([
			underscoreId,
		]);
	});

	it("checks hostname collisions before domain rename link guards", async () => {
		const linkedDomainId = await saveDomain(db, {
			hostname: "links.example.com",
		});
		const existingDomainId = await saveDomain(db, {
			hostname: "existing.example.com",
		});
		await saveLink(db, {
			hostname: "links.example.com",
			slug: "kept",
			targetUrl: "https://example.com/kept",
		});

		await expect(
			saveDomain(db, {
				id: linkedDomainId,
				hostname: "existing.example.com",
			}),
		).rejects.toThrow("errors.hostnameTaken");

		await expect(
			saveDomain(db, {
				id: linkedDomainId,
				hostname: "free.example.com",
			}),
		).rejects.toThrow("errors.domainRenameHasLinks");

		await expect(
			saveDomain(db, {
				id: existingDomainId,
				hostname: "renamed.example.com",
			}),
		).resolves.toBe(existingDomainId);
	});

	it("persists managed-domain fallback policies", async () => {
		const domainId = await saveDomain(db, {
			hostname: "brand.example.com",
			rootBehavior: "redirect",
			rootRedirectStatusCode: 308,
			rootRedirectTargetUrl: "brand.example.com/home",
			unknownSlugBehavior: "redirect",
			unknownSlugRedirectStatusCode: 302,
			unknownSlugRedirectTargetUrl: "https://brand.example.com/not-found",
		});

		const domain = await getManagedDomainByHostname(db, "brand.example.com");
		expect(domain?.id).toBe(domainId);
		expect(domain).toMatchObject({
			rootBehavior: "redirect",
			rootRedirectStatusCode: 308,
			rootRedirectTargetUrl: "https://brand.example.com/home",
			unknownSlugBehavior: "redirect",
			unknownSlugRedirectStatusCode: 302,
			unknownSlugRedirectTargetUrl: "https://brand.example.com/not-found",
		});
	});

	it("requires complete redirect settings for managed-domain fallback policies", async () => {
		await expect(
			saveDomain(db, {
				hostname: "brand.example.com",
				rootBehavior: "redirect",
			}),
		).rejects.toThrow("errors.domainRootRedirectStatusRequired");

		await expect(
			saveDomain(db, {
				hostname: "brand.example.com",
				unknownSlugBehavior: "redirect",
				unknownSlugRedirectStatusCode: 302,
			}),
		).rejects.toThrow("errors.domainUnknownSlugRedirectTargetRequired");
	});

	it("resolves exact host redirects without falling back to the default hostname", async () => {
		await saveDomain(db, {
			hostname: "brand.example.com",
		});
		await saveLink(db, {
			slug: "launch",
			targetUrl: "https://example.com/default-launch",
		});
		const customLinkId = await saveLink(db, {
			hostname: "brand.example.com",
			slug: "pricing",
			targetUrl: "https://brand.example.com/pricing",
		});

		await expect(
			resolveExactRedirect(db, {
				hostname: "brand.example.com",
				slug: "launch",
			}),
		).resolves.toBeNull();

		await expect(
			resolveExactRedirect(db, {
				hostname: "brand.example.com",
				slug: "pricing",
			}),
		).resolves.toMatchObject({ id: customLinkId });
	});

	it("supports the expanded redirect status code set in saves and filters", async () => {
		const temporaryId = await saveLink(db, {
			slug: "launch",
			statusCode: 307,
			targetUrl: "https://example.com/launch",
		});
		await saveLink(db, {
			slug: "pricing",
			statusCode: 308,
			targetUrl: "https://example.com/pricing",
		});

		const temporaryLinks = await listShortLinks(db, { statusCode: 307 });
		const permanentLinks = await listShortLinks(db, { statusCode: 308 });

		expect(temporaryLinks.items.map((item) => item.id)).toEqual([temporaryId]);
		expect(permanentLinks.items).toHaveLength(1);
		expect(permanentLinks.items[0]?.statusCode).toBe(308);
	});

	it("defaults unsupported redirect status codes to 302 in the service layer", async () => {
		const linkId = await saveLink(db, {
			slug: "fallback-status",
			statusCode: 399,
			targetUrl: "https://example.com/fallback",
		});

		const [link] = await db
			.select()
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId));

		expect(link?.statusCode).toBe(302);
	});

	it("buckets stats by the selected window and excludes empty or out-of-window UTM values", async () => {
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
				createdAt: windowStart - dayMs,
			},
		]);

		const stats = await getLinkStats(db, linkId, {
			breakdownLimit: 5,
			days: 2,
		});

		expect(stats.totals).toEqual({ allTime: 3, window: 2 });
		expect(stats.histogram.map((bucket) => bucket.total)).toEqual([1, 1]);
		expect(stats.breakdowns.utmSource).toEqual([
			{ value: "newsletter", total: 1 },
		]);
		expect(stats.breakdowns.utmMedium).toEqual([{ value: "email", total: 2 }]);
		expect(stats.userAgents.browser).toEqual([
			{ value: "Chrome", total: 1 },
			{ value: "Safari", total: 1 },
		]);
		expect(stats.userAgents.os).toEqual([
			{ value: "Windows", total: 1 },
			{ value: "iOS", total: 1 },
		]);
		expect(stats.userAgents.deviceType).toEqual([
			{ value: "desktop", total: 1 },
			{ value: "mobile", total: 1 },
		]);
	});

	it("persists UTM columns when recording redirect events", async () => {
		const linkId = await saveLink(db, {
			slug: "utm",
			targetUrl: "https://example.com/utm",
		});

		await recordRedirectEvent(db, {
			linkId,
			hostname: "__default__",
			slug: "utm",
			targetUrl: "https://example.com/utm",
			statusCode: 302,
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			utmCampaign: "spring",
			utmContent: "hero",
			utmMedium: "email",
			utmSource: "newsletter",
			utmTerm: "pricing",
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
		expect(link?.lastClickAt).toBe(event?.createdAt);
	});
});
