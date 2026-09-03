import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	analyticsAggregationState,
	redirectEventDaily,
	redirectEventDimensionDaily,
	redirectEvents,
} from "../../db/schema";
import { updateLinkHitMetadata } from "./counts";
import {
	ANALYTICS_AGGREGATION_STATE_ID,
	DIMENSIONS,
	dimensionValue,
	startOfUtcDay,
} from "./dimensions";

export { ANALYTICS_AGGREGATION_STATE_ID, startOfUtcDay };

const DEFAULT_AGGREGATE_BATCH_SIZE = 500;
const AGGREGATION_LEASE_MS = 15 * 60 * 1000;

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

		for (const dimension of DIMENSIONS) {
			const value = dimensionValue(
				dimension.empty,
				event[dimension.eventField],
			);
			if (value) {
				addDimension(dimensions, event.linkId, day, dimension.key, value);
			}
		}
	}

	return { daily, dimensions };
}

async function tryAcquireAggregationLease(
	db: AppDb,
	now: number,
): Promise<number | null> {
	const lockedUntil = now + AGGREGATION_LEASE_MS;
	await db
		.insert(analyticsAggregationState)
		.values({
			id: ANALYTICS_AGGREGATION_STATE_ID,
			lastSuccessAt: 0,
			lockedUntil: 0,
		})
		.onConflictDoNothing();

	const claimed = await db
		.update(analyticsAggregationState)
		.set({ lockedUntil })
		.where(
			and(
				eq(analyticsAggregationState.id, ANALYTICS_AGGREGATION_STATE_ID),
				lte(analyticsAggregationState.lockedUntil, now),
			),
		)
		.returning({ lockedUntil: analyticsAggregationState.lockedUntil });

	return claimed[0]?.lockedUntil ?? null;
}

async function releaseAggregationLease(
	db: AppDb,
	now: number,
	lockedUntil: number,
) {
	await db
		.update(analyticsAggregationState)
		.set({ lastSuccessAt: now, lockedUntil: 0 })
		.where(
			and(
				eq(analyticsAggregationState.id, ANALYTICS_AGGREGATION_STATE_ID),
				eq(analyticsAggregationState.lockedUntil, lockedUntil),
			),
		);
}

/**
 * Incrementally folds unaggregated `redirect_event` rows into daily rollups,
 * then optionally deletes rolled-up raw events older than `retainDays`.
 * Overlapping runs take a row lease so additive upserts cannot double-count.
 */
export async function aggregateAnalytics(
	db: AppDb,
	options: { now: number; retainDays?: number; batchSize?: number },
) {
	const batchSize = Math.max(
		1,
		options.batchSize ?? DEFAULT_AGGREGATE_BATCH_SIZE,
	);
	let leaseUntil: number | null = null;

	try {
		const pending = await db
			.select({ id: redirectEvents.id })
			.from(redirectEvents)
			.where(eq(redirectEvents.aggregated, false))
			.limit(1);
		if (pending.length > 0) {
			leaseUntil = await tryAcquireAggregationLease(db, Date.now());
			if (leaseUntil === null) {
				return;
			}

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
				const eventIds = events.map((event) => event.id);
				const linkIds = [...new Set(events.map((event) => event.linkId))];

				const statements = [
					...(daily.size > 0
						? [
								db
									.insert(redirectEventDaily)
									.values([...daily.values()])
									.onConflictDoUpdate({
										target: [redirectEventDaily.linkId, redirectEventDaily.day],
										set: {
											total: sql`${redirectEventDaily.total} + excluded.total`,
										},
									}),
							]
						: []),
					...(dimensions.size > 0
						? [
								db
									.insert(redirectEventDimensionDaily)
									.values([...dimensions.values()])
									.onConflictDoUpdate({
										target: [
											redirectEventDimensionDaily.linkId,
											redirectEventDimensionDaily.day,
											redirectEventDimensionDaily.dimension,
											redirectEventDimensionDaily.value,
										],
										set: {
											total: sql`${redirectEventDimensionDaily.total} + excluded.total`,
										},
									}),
							]
						: []),
					db
						.update(redirectEvents)
						.set({ aggregated: true })
						.where(inArray(redirectEvents.id, eventIds)),
					...linkIds.map((linkId) => updateLinkHitMetadata(db, linkId)),
				];

				await db.batch(
					statements as [(typeof statements)[0], ...typeof statements],
				);
			}
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
	} finally {
		if (leaseUntil !== null) {
			await releaseAggregationLease(db, options.now, leaseUntil);
		}
	}
}
