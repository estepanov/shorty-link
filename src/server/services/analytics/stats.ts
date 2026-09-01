import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	analyticsAggregationState,
	redirectEventDaily,
	redirectEventDimensionDaily,
	redirectEvents,
} from "../../db/schema";
import { ANALYTICS_AGGREGATION_STATE_ID, startOfUtcDay } from "./aggregate";

export const UTM_DIMENSIONS = [
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmTerm",
	"utmContent",
] as const;

export type UtmDimension = (typeof UTM_DIMENSIONS)[number];

export const USER_AGENT_DIMENSIONS = ["browser", "os", "deviceType"] as const;

export type UserAgentDimension = (typeof USER_AGENT_DIMENSIONS)[number];

function fillHistogram(
	days: number,
	windowStart: number,
	rows: Array<{ day: number; total: number }>,
) {
	const histogramMap = new Map<number, number>(
		rows.map((row) => [Number(row.day), Number(row.total)]),
	);
	const histogram: Array<{ day: number; total: number }> = [];
	for (let index = 0; index < days; index += 1) {
		const day = windowStart + index * 24 * 60 * 60 * 1000;
		histogram.push({ day, total: histogramMap.get(day) ?? 0 });
	}
	return histogram;
}

async function hasRollups(db: AppDb) {
	const [state] = await db
		.select({ id: analyticsAggregationState.id })
		.from(analyticsAggregationState)
		.where(eq(analyticsAggregationState.id, ANALYTICS_AGGREGATION_STATE_ID));
	return Boolean(state);
}

async function getRecentEvents(db: AppDb, linkId: string, recentLimit: number) {
	return db
		.select({
			id: redirectEvents.id,
			createdAt: redirectEvents.createdAt,
			country: redirectEvents.country,
			referer: redirectEvents.referer,
			utmSource: redirectEvents.utmSource,
			utmMedium: redirectEvents.utmMedium,
			utmCampaign: redirectEvents.utmCampaign,
			utmTerm: redirectEvents.utmTerm,
			utmContent: redirectEvents.utmContent,
			userAgentBrowser: redirectEvents.userAgentBrowser,
			userAgentOs: redirectEvents.userAgentOs,
			userAgentDeviceType: redirectEvents.userAgentDeviceType,
			userAgentIsBot: redirectEvents.userAgentIsBot,
		})
		.from(redirectEvents)
		.where(eq(redirectEvents.linkId, linkId))
		.orderBy(desc(redirectEvents.createdAt))
		.limit(recentLimit);
}

async function getLinkStatsFromRollups(
	db: AppDb,
	linkId: string,
	options: {
		days: number;
		windowStart: number;
		recentLimit: number;
		breakdownLimit: number;
	},
) {
	const linkColumn = eq(redirectEventDaily.linkId, linkId);
	const windowFilter = and(
		linkColumn,
		gte(redirectEventDaily.day, options.windowStart),
	);
	const dimensionLink = eq(redirectEventDimensionDaily.linkId, linkId);
	const dimensionWindow = and(
		dimensionLink,
		gte(redirectEventDimensionDaily.day, options.windowStart),
	);

	const [
		[totalsRow],
		[windowRow],
		histogramRows,
		breakdownEntries,
		userAgentBreakdownEntries,
		recentEvents,
	] = await Promise.all([
		db
			.select({
				total: sql<number>`coalesce(sum(${redirectEventDaily.total}), 0)`,
			})
			.from(redirectEventDaily)
			.where(linkColumn),
		db
			.select({
				total: sql<number>`coalesce(sum(${redirectEventDaily.total}), 0)`,
			})
			.from(redirectEventDaily)
			.where(windowFilter),
		db
			.select({
				day: redirectEventDaily.day,
				total: redirectEventDaily.total,
			})
			.from(redirectEventDaily)
			.where(windowFilter)
			.orderBy(redirectEventDaily.day),
		Promise.all(
			UTM_DIMENSIONS.map(async (dimension) => {
				const rows = await db
					.select({
						value: redirectEventDimensionDaily.value,
						total: sql<number>`sum(${redirectEventDimensionDaily.total})`.as(
							"total",
						),
					})
					.from(redirectEventDimensionDaily)
					.where(
						and(
							dimensionWindow,
							eq(redirectEventDimensionDaily.dimension, dimension),
						),
					)
					.groupBy(redirectEventDimensionDaily.value)
					.orderBy(desc(sql`sum(${redirectEventDimensionDaily.total})`))
					.limit(options.breakdownLimit);

				return [
					dimension,
					rows.map((row) => ({
						value: row.value,
						total: Number(row.total ?? 0),
					})),
				] as const;
			}),
		),
		Promise.all(
			USER_AGENT_DIMENSIONS.map(async (dimension) => {
				const rows = await db
					.select({
						value: redirectEventDimensionDaily.value,
						total: sql<number>`sum(${redirectEventDimensionDaily.total})`.as(
							"total",
						),
					})
					.from(redirectEventDimensionDaily)
					.where(
						and(
							dimensionWindow,
							eq(redirectEventDimensionDaily.dimension, dimension),
						),
					)
					.groupBy(redirectEventDimensionDaily.value)
					.orderBy(
						desc(sql`sum(${redirectEventDimensionDaily.total})`),
						asc(redirectEventDimensionDaily.value),
					)
					.limit(options.breakdownLimit);

				return [
					dimension,
					rows.map((row) => ({
						value: row.value,
						total: Number(row.total ?? 0),
					})),
				] as const;
			}),
		),
		getRecentEvents(db, linkId, options.recentLimit),
	]);

	return {
		totals: {
			allTime: Number(totalsRow?.total ?? 0),
			window: Number(windowRow?.total ?? 0),
		},
		windowDays: options.days,
		windowStart: options.windowStart,
		histogram: fillHistogram(options.days, options.windowStart, histogramRows),
		breakdowns: Object.fromEntries(breakdownEntries) as Record<
			UtmDimension,
			Array<{ value: string | null; total: number }>
		>,
		userAgents: Object.fromEntries(userAgentBreakdownEntries) as Record<
			UserAgentDimension,
			Array<{ value: string; total: number }>
		>,
		recentEvents,
	};
}

async function getLinkStatsFromEvents(
	db: AppDb,
	linkId: string,
	options: {
		days: number;
		windowStart: number;
		recentLimit: number;
		breakdownLimit: number;
	},
) {
	const linkColumn = eq(redirectEvents.linkId, linkId);
	const windowFilter = and(
		linkColumn,
		gte(redirectEvents.createdAt, options.windowStart),
	);
	const dayExpr = sql<number>`(${redirectEvents.createdAt} / 86400000) * 86400000`;

	const columnByDimension = {
		utmSource: redirectEvents.utmSource,
		utmMedium: redirectEvents.utmMedium,
		utmCampaign: redirectEvents.utmCampaign,
		utmTerm: redirectEvents.utmTerm,
		utmContent: redirectEvents.utmContent,
	} as const;

	const userAgentColumnByDimension = {
		browser: redirectEvents.userAgentBrowser,
		os: redirectEvents.userAgentOs,
		deviceType: redirectEvents.userAgentDeviceType,
	} as const;

	const [
		[totalsRow],
		[windowRow],
		histogramRows,
		breakdownEntries,
		userAgentBreakdownEntries,
		recentEvents,
	] = await Promise.all([
		db.select({ total: count() }).from(redirectEvents).where(linkColumn),
		db.select({ total: count() }).from(redirectEvents).where(windowFilter),
		db
			.select({
				day: dayExpr.as("day"),
				total: count(),
			})
			.from(redirectEvents)
			.where(windowFilter)
			.groupBy(dayExpr)
			.orderBy(dayExpr),
		Promise.all(
			UTM_DIMENSIONS.map(async (dimension) => {
				const column = columnByDimension[dimension];
				const rows = await db
					.select({ value: column, total: count() })
					.from(redirectEvents)
					.where(and(windowFilter, isNotNull(column)))
					.groupBy(column)
					.orderBy(desc(count()))
					.limit(options.breakdownLimit);

				return [
					dimension,
					rows.map((row) => ({
						value: row.value ?? null,
						total: Number(row.total ?? 0),
					})),
				] as const;
			}),
		),
		Promise.all(
			USER_AGENT_DIMENSIONS.map(async (dimension) => {
				const column = userAgentColumnByDimension[dimension];
				const rows = await db
					.select({ value: column, total: count() })
					.from(redirectEvents)
					.where(windowFilter)
					.groupBy(column)
					.orderBy(desc(count()), asc(column))
					.limit(options.breakdownLimit);

				return [
					dimension,
					rows.map((row) => ({
						value: row.value ?? "Unknown",
						total: Number(row.total ?? 0),
					})),
				] as const;
			}),
		),
		getRecentEvents(db, linkId, options.recentLimit),
	]);

	return {
		totals: {
			allTime: Number(totalsRow?.total ?? 0),
			window: Number(windowRow?.total ?? 0),
		},
		windowDays: options.days,
		windowStart: options.windowStart,
		histogram: fillHistogram(
			options.days,
			options.windowStart,
			histogramRows.map((row) => ({
				day: Number(row.day),
				total: Number(row.total),
			})),
		),
		breakdowns: Object.fromEntries(breakdownEntries) as Record<
			UtmDimension,
			Array<{ value: string | null; total: number }>
		>,
		userAgents: Object.fromEntries(userAgentBreakdownEntries) as Record<
			UserAgentDimension,
			Array<{ value: string; total: number }>
		>,
		recentEvents,
	};
}

export async function getLinkStats(
	db: AppDb,
	linkId: string,
	options?: { days?: number; recentLimit?: number; breakdownLimit?: number },
) {
	const days = Math.max(1, Math.min(options?.days ?? 30, 180));
	const recentLimit = Math.max(1, Math.min(options?.recentLimit ?? 20, 100));
	const breakdownLimit = Math.max(
		1,
		Math.min(options?.breakdownLimit ?? 10, 50),
	);
	const windowStart = startOfUtcDay(
		Date.now() - (days - 1) * 24 * 60 * 60 * 1000,
	);
	const resolved = { days, windowStart, recentLimit, breakdownLimit };

	if (await hasRollups(db)) {
		return getLinkStatsFromRollups(db, linkId, resolved);
	}

	return getLinkStatsFromEvents(db, linkId, resolved);
}
