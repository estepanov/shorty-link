import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	analyticsAggregationState,
	redirectEventDaily,
	redirectEventDimensionDaily,
	redirectEvents,
} from "../../db/schema";

export const ANALYTICS_AGGREGATION_STATE_ID = "default";

const UTM_DIMENSIONS = [
	["utmSource", "utmSource"],
	["utmMedium", "utmMedium"],
	["utmCampaign", "utmCampaign"],
	["utmTerm", "utmTerm"],
	["utmContent", "utmContent"],
] as const;

const USER_AGENT_DIMENSIONS = [
	["browser", "userAgentBrowser"],
	["os", "userAgentOs"],
	["deviceType", "userAgentDeviceType"],
] as const;

export function startOfUtcDay(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}

type DailyBucket = { linkId: string; day: number; total: number };
type DimensionBucket = DailyBucket & { dimension: string; value: string };

function addDaily(map: Map<string, DailyBucket>, linkId: string, day: number) {
	const key = `${linkId}:${day}`;
	const current = map.get(key);
	if (current) {
		current.total += 1;
		return;
	}
	map.set(key, { linkId, day, total: 1 });
}

function addDimension(
	map: Map<string, DimensionBucket>,
	linkId: string,
	day: number,
	dimension: string,
	value: string,
) {
	const key = `${linkId}:${day}:${dimension}:${value}`;
	const current = map.get(key);
	if (current) {
		current.total += 1;
		return;
	}
	map.set(key, { linkId, day, dimension, value, total: 1 });
}

/**
 * Incrementally folds new `redirect_event` rows into daily rollups, then
 * optionally deletes rolled-up raw events older than `retainDays`.
 */
export async function aggregateAnalytics(
	db: AppDb,
	options: { now: number; retainDays?: number },
) {
	const [state] = await db
		.select()
		.from(analyticsAggregationState)
		.where(eq(analyticsAggregationState.id, ANALYTICS_AGGREGATION_STATE_ID));
	const watermark = state?.lastEventCreatedAt ?? 0;

	const events = await db
		.select()
		.from(redirectEvents)
		.where(gt(redirectEvents.createdAt, watermark));

	let nextWatermark = watermark;

	if (events.length > 0) {
		const daily = new Map<string, DailyBucket>();
		const dimensions = new Map<string, DimensionBucket>();

		for (const event of events) {
			const day = startOfUtcDay(event.createdAt);
			addDaily(daily, event.linkId, day);

			for (const [dimension, field] of UTM_DIMENSIONS) {
				const value = event[field];
				if (value) {
					addDimension(dimensions, event.linkId, day, dimension, value);
				}
			}

			for (const [dimension, field] of USER_AGENT_DIMENSIONS) {
				addDimension(
					dimensions,
					event.linkId,
					day,
					dimension,
					event[field] ?? "Unknown",
				);
			}
		}

		nextWatermark = Math.max(...events.map((event) => event.createdAt));

		const statements = [
			...[...daily.values()].map((bucket) =>
				db
					.insert(redirectEventDaily)
					.values(bucket)
					.onConflictDoUpdate({
						target: [redirectEventDaily.linkId, redirectEventDaily.day],
						set: {
							total: sql`${redirectEventDaily.total} + ${bucket.total}`,
						},
					}),
			),
			...[...dimensions.values()].map((bucket) =>
				db
					.insert(redirectEventDimensionDaily)
					.values(bucket)
					.onConflictDoUpdate({
						target: [
							redirectEventDimensionDaily.linkId,
							redirectEventDimensionDaily.day,
							redirectEventDimensionDaily.dimension,
							redirectEventDimensionDaily.value,
						],
						set: {
							total: sql`${redirectEventDimensionDaily.total} + ${bucket.total}`,
						},
					}),
			),
			db
				.insert(analyticsAggregationState)
				.values({
					id: ANALYTICS_AGGREGATION_STATE_ID,
					lastSuccessAt: options.now,
					lastEventCreatedAt: nextWatermark,
				})
				.onConflictDoUpdate({
					target: analyticsAggregationState.id,
					set: {
						lastSuccessAt: options.now,
						lastEventCreatedAt: nextWatermark,
					},
				}),
		];

		await db.batch(
			statements as [(typeof statements)[0], ...typeof statements],
		);
	}

	if (!options.retainDays || options.retainDays <= 0 || nextWatermark <= 0) {
		return;
	}

	const cutoff = options.now - options.retainDays * 86_400_000;
	await db
		.delete(redirectEvents)
		.where(
			and(
				lte(redirectEvents.createdAt, nextWatermark),
				lt(redirectEvents.createdAt, cutoff),
			),
		);
}
