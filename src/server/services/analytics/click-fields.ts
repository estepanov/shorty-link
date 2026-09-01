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
} as const;

export function truncateStoredText(
	value: string | null | undefined,
	maxLength: number,
) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}
