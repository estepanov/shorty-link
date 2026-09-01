import type { AppDb } from "../../db/client";
import { parseAnalyticsQueueMessage, persistClicks } from "./record-click";

export type AnalyticsQueueBatch = {
	messages: readonly {
		body: unknown;
		retry: () => void;
	}[];
};

/**
 * Persists valid queued click messages and retries unparseable ones so
 * Cloudflare can dead-letter them after max_retries.
 */
export async function consumeAnalyticsBatch(
	db: AppDb,
	batch: AnalyticsQueueBatch,
) {
	const valid = [];
	for (const message of batch.messages) {
		const parsed = parseAnalyticsQueueMessage(message.body);
		if (!parsed) {
			message.retry();
			continue;
		}
		valid.push({
			...parsed.click,
			id: parsed.id,
			createdAt: parsed.createdAt,
		});
	}

	await persistClicks(db, valid);
}
