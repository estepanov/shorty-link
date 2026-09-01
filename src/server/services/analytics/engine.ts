import { normalizeClickFields, type RecordClickInput } from "./click-fields";

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

/**
 * Stable Analytics Engine columns for the optional `ANALYTICS` binding.
 * `index1` is `linkId`. `double1` is `statusCode`. Blobs are hostname, slug,
 * country, city, colo, referer, userAgent, utmSource, utmMedium, utmCampaign,
 * utmTerm, utmContent, then targetUrl.
 */
export function toAnalyticsEngineDataPoint(
	input: RecordClickInput,
): AnalyticsEngineDataPoint {
	const fields = normalizeClickFields(input);
	return {
		indexes: [input.linkId],
		blobs: [
			input.hostname,
			input.slug,
			fields.country ?? "",
			fields.city ?? "",
			fields.colo ?? "",
			fields.referer ?? "",
			fields.userAgent ?? "",
			fields.utmSource ?? "",
			fields.utmMedium ?? "",
			fields.utmCampaign ?? "",
			fields.utmTerm ?? "",
			fields.utmContent ?? "",
			fields.targetUrl,
		],
		doubles: [input.statusCode],
	};
}
