import { eq, sql } from "drizzle-orm";
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
		updatedAt: linkLastClickSql(linkId),
	};
}

export function updateLinkHitMetadata(db: AppDb, linkId: string) {
	return db
		.update(shortLinks)
		.set(linkHitMetadataSet(linkId))
		.where(eq(shortLinks.id, linkId));
}
