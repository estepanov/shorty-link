import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	analyticsAggregationState,
	redirectEventDaily,
	redirectEventDimensionDaily,
	redirectEvents,
} from "../../db/schema";
import {
	ANALYTICS_AGGREGATION_STATE_ID,
	startOfUtcDay,
	USER_AGENT_DIMENSIONS,
	USER_AGENT_EVENT_FIELDS,
	type UserAgentDimension,
	UTM_DIMENSIONS,
	UTM_EVENT_FIELDS,
	type UtmDimension,
} from "./dimensions";

export {
	USER_AGENT_DIMENSIONS,
	type UserAgentDimension,
	UTM_DIMENSIONS,
	type UtmDimension,
};

type CountedValue = { value: string | null; total: number };
type NamedValue = { value: string; total: number };

type StatsPartials = {
	allTime: number;
	window: number;
	histogramRows: Array<{ day: number; total: number }>;
	breakdowns: Record<UtmDimension, CountedValue[]>;
	userAgents: Record<UserAgentDimension, NamedValue[]>;
};

function emptyPartials(): StatsPartials {
	return {
		allTime: 0,
		window: 0,
		histogramRows: [],
		breakdowns: {
			utmSource: [],
			utmMedium: [],
			utmCampaign: [],
			utmTerm: [],
			utmContent: [],
		},
		userAgents: {
			browser: [],
			os: [],
			deviceType: [],
		},
	};
}

function fillHistogram(
	days: number,
	windowStart: number,
	rows: Array<{ day: number; total: number }>,
) {
	const histogramMap = new Map<number, number>();
	for (const row of rows) {
		const day = Number(row.day);
		histogramMap.set(day, (histogramMap.get(day) ?? 0) + Number(row.total));
	}
	const histogram: Array<{ day: number; total: number }> = [];
	for (let index = 0; index < days; index += 1) {
		const day = windowStart + index * 24 * 60 * 60 * 1000;
		histogram.push({ day, total: histogramMap.get(day) ?? 0 });
	}
	return histogram;
}

function mergeCounted(
	left: CountedValue[],
	right: CountedValue[],
	limit: number,
	empty: "omit" | "unknown",
): NamedValue[] {
	const totals = new Map<string, number>();
	for (const row of [...left, ...right]) {
		const value = row.value ?? (empty === "unknown" ? "Unknown" : null);
		if (value === null) {
			continue;
		}
		totals.set(value, (totals.get(value) ?? 0) + Number(row.total ?? 0));
	}

	return [...totals.entries()]
		.map(([value, total]) => ({ value, total }))
		.sort((leftRow, rightRow) => {
			if (rightRow.total !== leftRow.total) {
				return rightRow.total - leftRow.total;
			}
			if (leftRow.value === rightRow.value) {
				return 0;
			}
			return leftRow.value < rightRow.value ? -1 : 1;
		})
		.slice(0, limit);
}

function mergePartials(
	left: StatsPartials,
	right: StatsPartials,
	breakdownLimit: number,
): StatsPartials {
	return {
		allTime: left.allTime + right.allTime,
		window: left.window + right.window,
		histogramRows: [...left.histogramRows, ...right.histogramRows],
		breakdowns: Object.fromEntries(
			UTM_DIMENSIONS.map((dimension) => [
				dimension,
				mergeCounted(
					left.breakdowns[dimension],
					right.breakdowns[dimension],
					breakdownLimit,
					"omit",
				),
			]),
		) as Record<UtmDimension, NamedValue[]>,
		userAgents: Object.fromEntries(
			USER_AGENT_DIMENSIONS.map((dimension) => [
				dimension,
				mergeCounted(
					left.userAgents[dimension],
					right.userAgents[dimension],
					breakdownLimit,
					"unknown",
				),
			]),
		) as Record<UserAgentDimension, NamedValue[]>,
	};
}

async function readWatermark(db: AppDb) {
	const [state] = await db
		.select({
			lastEventCreatedAt: analyticsAggregationState.lastEventCreatedAt,
		})
		.from(analyticsAggregationState)
		.where(eq(analyticsAggregationState.id, ANALYTICS_AGGREGATION_STATE_ID));
	return state?.lastEventCreatedAt ?? 0;
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

async function queryRollupPartials(
	db: AppDb,
	linkId: string,
	windowStart: number,
): Promise<StatsPartials> {
	const linkColumn = eq(redirectEventDaily.linkId, linkId);
	const windowFilter = and(
		linkColumn,
		gte(redirectEventDaily.day, windowStart),
	);
	const dimensionWindow = and(
		eq(redirectEventDimensionDaily.linkId, linkId),
		gte(redirectEventDimensionDaily.day, windowStart),
	);

	const [[totalsRow], [windowRow], histogramRows, breakdowns, userAgents] =
		await Promise.all([
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
						.groupBy(redirectEventDimensionDaily.value);

					return [dimension, rows] as const;
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
						.groupBy(redirectEventDimensionDaily.value);

					return [dimension, rows] as const;
				}),
			),
		]);

	return {
		allTime: Number(totalsRow?.total ?? 0),
		window: Number(windowRow?.total ?? 0),
		histogramRows: histogramRows.map((row) => ({
			day: Number(row.day),
			total: Number(row.total),
		})),
		breakdowns: Object.fromEntries(breakdowns) as StatsPartials["breakdowns"],
		userAgents: Object.fromEntries(userAgents) as StatsPartials["userAgents"],
	};
}

async function queryEventPartials(
	db: AppDb,
	linkId: string,
	windowStart: number,
): Promise<StatsPartials> {
	const linkColumn = and(
		eq(redirectEvents.linkId, linkId),
		eq(redirectEvents.aggregated, false),
	);
	const windowFilter = and(
		linkColumn,
		gte(redirectEvents.createdAt, windowStart),
	);
	const dayExpr = sql<number>`(${redirectEvents.createdAt} / 86400000) * 86400000`;

	const [[totalsRow], [windowRow], histogramRows, breakdowns, userAgents] =
		await Promise.all([
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
					const column = redirectEvents[UTM_EVENT_FIELDS[dimension]];
					const rows = await db
						.select({ value: column, total: count() })
						.from(redirectEvents)
						.where(and(windowFilter, isNotNull(column)))
						.groupBy(column);

					return [dimension, rows] as const;
				}),
			),
			Promise.all(
				USER_AGENT_DIMENSIONS.map(async (dimension) => {
					const column = redirectEvents[USER_AGENT_EVENT_FIELDS[dimension]];
					const rows = await db
						.select({ value: column, total: count() })
						.from(redirectEvents)
						.where(windowFilter)
						.groupBy(column);

					return [dimension, rows] as const;
				}),
			),
		]);

	return {
		allTime: Number(totalsRow?.total ?? 0),
		window: Number(windowRow?.total ?? 0),
		histogramRows: histogramRows.map((row) => ({
			day: Number(row.day),
			total: Number(row.total),
		})),
		breakdowns: Object.fromEntries(breakdowns) as StatsPartials["breakdowns"],
		userAgents: Object.fromEntries(userAgents) as StatsPartials["userAgents"],
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
	const watermark = await readWatermark(db);
	const [rollups, tail, recentEvents] = await Promise.all([
		watermark > 0
			? queryRollupPartials(db, linkId, windowStart)
			: emptyPartials(),
		queryEventPartials(db, linkId, windowStart),
		getRecentEvents(db, linkId, recentLimit),
	]);
	const merged = mergePartials(rollups, tail, breakdownLimit);

	return {
		totals: {
			allTime: merged.allTime,
			window: merged.window,
		},
		windowDays: days,
		windowStart,
		histogram: fillHistogram(days, windowStart, merged.histogramRows),
		breakdowns: merged.breakdowns,
		userAgents: merged.userAgents,
		recentEvents,
	};
}
