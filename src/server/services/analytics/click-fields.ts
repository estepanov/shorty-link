/**
 * Fields required to record one redirect click for analytics. Matches the data the
 * redirect handler already collects; `recordClick` normalizes and persists it.
 *
 * Callers should pass `targetUrl` from `buildAnalyticsTarget` and UTM fields from
 * `extractUtmParams` (both in `src/server/services/analytics/target.ts`). That way
 * only UTM query params from the incoming request are merged when the link
 * preserves query params; non-UTM request params are never copied into the stored
 * analytics URL.
 */
export type RecordClickInput = {
	linkId: string;
	hostname: string;
	slug: string;
	/** Analytics target URL (UTM-safe query merge only). */
	targetUrl: string;
	statusCode: number;
	country?: string | null;
	city?: string | null;
	colo?: string | null;
	referer?: string | null;
	userAgent?: string | null;
	ipHash?: string | null;
	utmSource?: string | null;
	utmMedium?: string | null;
	utmCampaign?: string | null;
	utmTerm?: string | null;
	utmContent?: string | null;
};

export const CLICK_FIELD_LIMITS = {
	country: 32,
	city: 128,
	colo: 32,
	referer: 2048,
	userAgent: 512,
	utmSource: 256,
	utmMedium: 256,
	utmCampaign: 256,
	utmTerm: 256,
	utmContent: 256,
	targetUrl: 2048,
	ipHash: 64,
} as const;

export function truncateStoredText(
	value: string | null | undefined,
	maxLength: number,
) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}

export function normalizeClickFields(input: RecordClickInput) {
	return {
		country: truncateStoredText(input.country, CLICK_FIELD_LIMITS.country),
		city: truncateStoredText(input.city, CLICK_FIELD_LIMITS.city),
		colo: truncateStoredText(input.colo, CLICK_FIELD_LIMITS.colo),
		referer: truncateStoredText(input.referer, CLICK_FIELD_LIMITS.referer),
		userAgent: truncateStoredText(
			input.userAgent,
			CLICK_FIELD_LIMITS.userAgent,
		),
		utmSource: truncateStoredText(
			input.utmSource,
			CLICK_FIELD_LIMITS.utmSource,
		),
		utmMedium: truncateStoredText(
			input.utmMedium,
			CLICK_FIELD_LIMITS.utmMedium,
		),
		utmCampaign: truncateStoredText(
			input.utmCampaign,
			CLICK_FIELD_LIMITS.utmCampaign,
		),
		utmTerm: truncateStoredText(input.utmTerm, CLICK_FIELD_LIMITS.utmTerm),
		utmContent: truncateStoredText(
			input.utmContent,
			CLICK_FIELD_LIMITS.utmContent,
		),
		targetUrl:
			truncateStoredText(input.targetUrl, CLICK_FIELD_LIMITS.targetUrl) ?? "",
		ipHash: truncateStoredText(input.ipHash, CLICK_FIELD_LIMITS.ipHash),
	};
}
