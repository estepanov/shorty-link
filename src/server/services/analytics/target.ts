import { normalizeTargetUrl } from "../links";
import { CLICK_FIELD_LIMITS, truncateStoredText } from "./click-fields";

const ANALYTICS_SAFE_QUERY_KEYS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
]);

export function buildAnalyticsTarget(
	targetUrl: string,
	requestUrl: string,
	preserveQueryParams: boolean,
) {
	const destination = new URL(normalizeTargetUrl(targetUrl));

	if (!preserveQueryParams) {
		return destination.toString();
	}

	const incoming = new URL(requestUrl);

	for (const [key, value] of incoming.searchParams.entries()) {
		if (
			ANALYTICS_SAFE_QUERY_KEYS.has(key.toLowerCase()) &&
			!destination.searchParams.has(key)
		) {
			destination.searchParams.append(key, value);
		}
	}

	return destination.toString();
}

export function extractUtmParams(requestUrl: string) {
	try {
		const params = new URL(requestUrl).searchParams;
		const read = (key: string, maxLength: number) =>
			truncateStoredText(params.get(key), maxLength);

		return {
			utmSource: read("utm_source", CLICK_FIELD_LIMITS.utmSource),
			utmMedium: read("utm_medium", CLICK_FIELD_LIMITS.utmMedium),
			utmCampaign: read("utm_campaign", CLICK_FIELD_LIMITS.utmCampaign),
			utmTerm: read("utm_term", CLICK_FIELD_LIMITS.utmTerm),
			utmContent: read("utm_content", CLICK_FIELD_LIMITS.utmContent),
		};
	} catch {
		return {
			utmSource: null,
			utmMedium: null,
			utmCampaign: null,
			utmTerm: null,
			utmContent: null,
		};
	}
}
