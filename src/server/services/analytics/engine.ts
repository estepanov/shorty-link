import { CLICK_FIELD_LIMITS, truncateStoredText } from "./click-fields";
import type { RecordClickInput } from "./record-click";

export type AnalyticsEngineDataPoint = {
	indexes: [string];
	blobs: string[];
	doubles: number[];
};

export type AnalyticsEngineWriter = {
	writeDataPoint(event: AnalyticsEngineDataPoint): void;
};

type AnalyticsEngineBindings = {
	ANALYTICS?: unknown;
};

function isEngineWriter(value: unknown): value is AnalyticsEngineWriter {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as AnalyticsEngineWriter).writeDataPoint === "function"
	);
}

export function getAnalyticsEngine(
	bindings: object | undefined,
): AnalyticsEngineWriter | undefined {
	if (!bindings || !("ANALYTICS" in bindings)) {
		return undefined;
	}

	const engine = (bindings as AnalyticsEngineBindings).ANALYTICS;
	return isEngineWriter(engine) ? engine : undefined;
}

function analyticsBlob(value: string | null | undefined, maxLength: number) {
	return truncateStoredText(value, maxLength) ?? "";
}

/**
 * Stable Analytics Engine columns for the optional `ANALYTICS` binding.
 * `index1` is `linkId`. `double1` is `statusCode`. Blobs are hostname, slug,
 * country, city, colo, referer, userAgent, utmSource, utmMedium, utmCampaign,
 * utmTerm, utmContent, then targetUrl.
 */
export function toAnalyticsEngineDataPoint(
	input: RecordClickInput,
): AnalyticsEngineDataPoint {
	return {
		indexes: [input.linkId],
		blobs: [
			input.hostname,
			input.slug,
			analyticsBlob(input.country, CLICK_FIELD_LIMITS.country),
			analyticsBlob(input.city, CLICK_FIELD_LIMITS.city),
			analyticsBlob(input.colo, CLICK_FIELD_LIMITS.colo),
			analyticsBlob(input.referer, CLICK_FIELD_LIMITS.referer),
			analyticsBlob(input.userAgent, CLICK_FIELD_LIMITS.userAgent),
			analyticsBlob(input.utmSource, CLICK_FIELD_LIMITS.utmSource),
			analyticsBlob(input.utmMedium, CLICK_FIELD_LIMITS.utmMedium),
			analyticsBlob(input.utmCampaign, CLICK_FIELD_LIMITS.utmCampaign),
			analyticsBlob(input.utmTerm, CLICK_FIELD_LIMITS.utmTerm),
			analyticsBlob(input.utmContent, CLICK_FIELD_LIMITS.utmContent),
			analyticsBlob(input.targetUrl, CLICK_FIELD_LIMITS.targetUrl),
		],
		doubles: [input.statusCode],
	};
}
