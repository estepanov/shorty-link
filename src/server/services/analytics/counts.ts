import { and, count, eq, type SQL, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import {
	redirectEventDaily,
	redirectEvents,
	shortLinks,
} from "../../db/schema";

export function linkHitCountSql(linkId: string) {
	return sql<number>`(
		coalesce((select sum(${redirectEventDaily.total}) from ${redirectEventDaily} where ${redirectEventDaily.linkId} = ${linkId}), 0)
		+ (select count(*) from ${redirectEvents} where ${redirectEvents.linkId} = ${linkId} and ${redirectEvents.aggregated} = 0)
	)`;
}

export function linkLastClickSql(linkId: string) {
	return sql`max(
		coalesce(${shortLinks.lastClickAt}, 0),
		coalesce((select max(${redirectEvents.createdAt}) from ${redirectEvents} where ${redirectEvents.linkId} = ${linkId}), 0)
	)`;
}

export function linkHitMetadataSet(linkId: string) {
	return {
		hitCount: linkHitCountSql(linkId),
		lastClickAt: linkLastClickSql(linkId),
	};
}

export function updateLinkHitMetadata(db: AppDb, linkId: string) {
	return db
		.update(shortLinks)
		.set(linkHitMetadataSet(linkId))
		.where(eq(shortLinks.id, linkId));
}

/**
 * All-time tracked-redirect total: daily rollups plus unaggregated raw events.
 * Matches `linkHitCountSql` / `getLinkStats.totals.allTime` so the dashboard
 * stays correct after retention deletes rolled-up rows.
 */
export async function countTrackedRedirects(
	db: AppDb,
	options: {
		linkCondition?: SQL;
		eventCondition?: SQL;
	} = {},
) {
	const tailFilter = options.eventCondition
		? and(eq(redirectEvents.aggregated, false), options.eventCondition)
		: eq(redirectEvents.aggregated, false);

	const [[rollupRow], [tailRow]] = await Promise.all([
		db
			.select({
				total: sql<number>`coalesce(sum(${redirectEventDaily.total}), 0)`,
			})
			.from(redirectEventDaily)
			.innerJoin(shortLinks, eq(shortLinks.id, redirectEventDaily.linkId))
			.where(options.linkCondition),
		db.select({ total: count() }).from(redirectEvents).where(tailFilter),
	]);

	return Number(rollupRow?.total ?? 0) + Number(tailRow?.total ?? 0);
}
