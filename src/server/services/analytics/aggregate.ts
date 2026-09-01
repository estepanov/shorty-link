import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
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
	UTM_DIMENSIONS,
	UTM_EVENT_FIELDS,
} from "./dimensions";

export { ANALYTICS_AGGREGATION_STATE_ID, startOfUtcDay };

const DEFAULT_AGGREGATE_BATCH_SIZE = 500;

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

function foldEvents(events: Array<typeof redirectEvents.$inferSelect>) {
	const daily = new Map<string, DailyBucket>();
	const dimensions = new Map<string, DimensionBucket>();

	for (const event of events) {
		const day = startOfUtcDay(event.createdAt);
		addDaily(daily, event.linkId, day);

		for (const dimension of UTM_DIMENSIONS) {
			const value = event[UTM_EVENT_FIELDS[dimension]];
			if (value) {
				addDimension(dimensions, event.linkId, day, dimension, value);
			}
		}

		for (const dimension of USER_AGENT_DIMENSIONS) {
			addDimension(
				dimensions,
				event.linkId,
				day,
				dimension,
				event[USER_AGENT_EVENT_FIELDS[dimension]] ?? "Unknown",
			);
		}
	}

	return { daily, dimensions };
}

/**
 * Incrementally folds unaggregated `redirect_event` rows into daily rollups,
 * then optionally deletes rolled-up raw events older than `retainDays`.
 */
export async function aggregateAnalytics(
	db: AppDb,
	options: { now: number; retainDays?: number; batchSize?: number },
) {
	const batchSize = Math.max(
		1,
		options.batchSize ?? DEFAULT_AGGREGATE_BATCH_SIZE,
	);
	let watermark = 0;

	while (true) {
		const events = await db
			.select()
			.from(redirectEvents)
			.where(eq(redirectEvents.aggregated, false))
			.orderBy(asc(redirectEvents.createdAt), asc(redirectEvents.id))
			.limit(batchSize);
		if (events.length === 0) {
			break;
		}

		const { daily, dimensions } = foldEvents(events);
		watermark = Math.max(...events.map((event) => event.createdAt));
		const eventIds = events.map((event) => event.id);

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
				.update(redirectEvents)
				.set({ aggregated: true })
				.where(inArray(redirectEvents.id, eventIds)),
			db
				.insert(analyticsAggregationState)
				.values({
					id: ANALYTICS_AGGREGATION_STATE_ID,
					lastSuccessAt: options.now,
					lastEventCreatedAt: watermark,
				})
				.onConflictDoUpdate({
					target: analyticsAggregationState.id,
					set: {
						lastSuccessAt: options.now,
						lastEventCreatedAt: watermark,
					},
				}),
		];

		await db.batch(
			statements as [(typeof statements)[0], ...typeof statements],
		);
	}

	if (!options.retainDays || options.retainDays <= 0) {
		return;
	}

	const cutoff = options.now - options.retainDays * 86_400_000;
	await db
		.delete(redirectEvents)
		.where(
			and(
				eq(redirectEvents.aggregated, true),
				lt(redirectEvents.createdAt, cutoff),
			),
		);
}
