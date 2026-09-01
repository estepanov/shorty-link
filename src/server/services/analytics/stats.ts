import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	redirectEventDaily,
	redirectEventDimensionDaily,
	redirectEvents,
	shortLinks,
} from "../../db/schema";
import { linkHitCountSql } from "./counts";
import {
	DIMENSIONS,
	type Dimension,
	isUtmDimension,
	startOfUtcDay,
	type UserAgentDimension,
	type UtmDimension,
} from "./dimensions";

export type { UserAgentDimension, UtmDimension };

type CountedValue = { value: string | null; total: number };
type NamedValue = { value: string; total: number };

type StatsPartials = {
	window: number;
	histogramRows: Array<{ day: number; total: number }>;
	breakdowns: Record<UtmDimension, CountedValue[]>;
	userAgents: Record<UserAgentDimension, CountedValue[]>;
};

function emptyUtmBreakdowns(): Record<UtmDimension, CountedValue[]> {
	return {
		utmSource: [],
		utmMedium: [],
		utmCampaign: [],
		utmTerm: [],
		utmContent: [],
	};
}

function emptyUserAgents(): Record<UserAgentDimension, CountedValue[]> {
	return {
		browser: [],
		os: [],
		deviceType: [],
	};
}

function emptyNamedUtm(): Record<UtmDimension, NamedValue[]> {
	return {
		utmSource: [],
		utmMedium: [],
		utmCampaign: [],
		utmTerm: [],
		utmContent: [],
	};
}

function emptyNamedUserAgents(): Record<UserAgentDimension, NamedValue[]> {
	return {
		browser: [],
		os: [],
		deviceType: [],
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
	empty: Dimension["empty"],
): NamedValue[] {
	const totals = new Map<string, number>();
	for (const row of [...left, ...right]) {
		let value: string | null;
		switch (empty) {
			case "omit":
				value = row.value;
				break;
			case "unknown":
				value = row.value ?? "Unknown";
				break;
			default: {
				const _exhaustive: never = empty;
				throw new Error(`Unhandled dimension empty policy: ${_exhaustive}`);
			}
		}
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

type MergedPartials = {
	window: number;
	histogramRows: Array<{ day: number; total: number }>;
	breakdowns: Record<UtmDimension, NamedValue[]>;
	userAgents: Record<UserAgentDimension, NamedValue[]>;
};

function mergePartials(
	left: StatsPartials,
	right: StatsPartials,
	breakdownLimit: number,
): MergedPartials {
	const breakdowns = emptyNamedUtm();
	const userAgents = emptyNamedUserAgents();

	for (const dimension of DIMENSIONS) {
		const merged = mergeCounted(
			isUtmDimension(dimension)
				? left.breakdowns[dimension.key]
				: left.userAgents[dimension.key],
			isUtmDimension(dimension)
				? right.breakdowns[dimension.key]
				: right.userAgents[dimension.key],
			breakdownLimit,
			dimension.empty,
		);
		if (isUtmDimension(dimension)) {
			breakdowns[dimension.key] = merged;
		} else {
			userAgents[dimension.key] = merged;
		}
	}

	return {
		window: left.window + right.window,
		histogramRows: [...left.histogramRows, ...right.histogramRows],
		breakdowns,
		userAgents,
	};
}

function partitionDimensionRows(
	rows: Array<{ dimension: string; value: string | null; total: number }>,
): Pick<StatsPartials, "breakdowns" | "userAgents"> {
	const breakdowns = emptyUtmBreakdowns();
	const userAgents = emptyUserAgents();
	const byKey = new Map<string, CountedValue[]>();
	for (const dimension of DIMENSIONS) {
		byKey.set(dimension.key, []);
	}
	for (const row of rows) {
		byKey.get(row.dimension)?.push({
			value: row.value,
			total: Number(row.total),
		});
	}
	for (const dimension of DIMENSIONS) {
		const values = byKey.get(dimension.key) ?? [];
		if (isUtmDimension(dimension)) {
			breakdowns[dimension.key] = values;
		} else {
			userAgents[dimension.key] = values;
		}
	}
	return { breakdowns, userAgents };
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
	const windowFilter = and(
		eq(redirectEventDaily.linkId, linkId),
		gte(redirectEventDaily.day, windowStart),
	);
	const dimensionWindow = and(
		eq(redirectEventDimensionDaily.linkId, linkId),
		gte(redirectEventDimensionDaily.day, windowStart),
	);

	const [[windowRow], histogramRows, dimensionRows] = await Promise.all([
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
		db
			.select({
				dimension: redirectEventDimensionDaily.dimension,
				value: redirectEventDimensionDaily.value,
				total: sql<number>`sum(${redirectEventDimensionDaily.total})`.as(
					"total",
				),
			})
			.from(redirectEventDimensionDaily)
			.where(dimensionWindow)
			.groupBy(
				redirectEventDimensionDaily.dimension,
				redirectEventDimensionDaily.value,
			),
	]);

	return {
		window: Number(windowRow?.total ?? 0),
		histogramRows: histogramRows.map((row) => ({
			day: Number(row.day),
			total: Number(row.total),
		})),
		...partitionDimensionRows(dimensionRows),
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

	const [[windowRow], histogramRows, dimensionResults] = await Promise.all([
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
			DIMENSIONS.map(async (dimension) => {
				const column = redirectEvents[dimension.eventField];
				const filter =
					dimension.empty === "omit"
						? and(windowFilter, isNotNull(column))
						: windowFilter;
				const rows = await db
					.select({ value: column, total: count() })
					.from(redirectEvents)
					.where(filter)
					.groupBy(column);
				return [dimension.key, rows] as const;
			}),
		),
	]);

	return {
		window: Number(windowRow?.total ?? 0),
		histogramRows: histogramRows.map((row) => ({
			day: Number(row.day),
			total: Number(row.total),
		})),
		...partitionDimensionRows(
			dimensionResults.flatMap(([dimension, rows]) =>
				rows.map((row) => ({
					dimension,
					value: row.value,
					total: Number(row.total),
				})),
			),
		),
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
	const [[allTimeRow], rollups, tail, recentEvents] = await Promise.all([
		db
			.select({ total: linkHitCountSql(linkId) })
			.from(shortLinks)
			.where(eq(shortLinks.id, linkId)),
		queryRollupPartials(db, linkId, windowStart),
		queryEventPartials(db, linkId, windowStart),
		getRecentEvents(db, linkId, recentLimit),
	]);
	const merged = mergePartials(rollups, tail, breakdownLimit);

	return {
		totals: {
			allTime: Number(allTimeRow?.total ?? 0),
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
