export const ANALYTICS_AGGREGATION_STATE_ID = "default";

export type DimensionEmptyPolicy = "omit" | "unknown";
export type DimensionGroup = "utm" | "ua";

export const DIMENSIONS = [
	{
		key: "utmSource",
		eventField: "utmSource",
		empty: "omit",
		group: "utm",
	},
	{
		key: "utmMedium",
		eventField: "utmMedium",
		empty: "omit",
		group: "utm",
	},
	{
		key: "utmCampaign",
		eventField: "utmCampaign",
		empty: "omit",
		group: "utm",
	},
	{
		key: "utmTerm",
		eventField: "utmTerm",
		empty: "omit",
		group: "utm",
	},
	{
		key: "utmContent",
		eventField: "utmContent",
		empty: "omit",
		group: "utm",
	},
	{
		key: "browser",
		eventField: "userAgentBrowser",
		empty: "unknown",
		group: "ua",
	},
	{
		key: "os",
		eventField: "userAgentOs",
		empty: "unknown",
		group: "ua",
	},
	{
		key: "deviceType",
		eventField: "userAgentDeviceType",
		empty: "unknown",
		group: "ua",
	},
] as const;

export type Dimension = (typeof DIMENSIONS)[number];
export type UtmDimension = Extract<Dimension, { group: "utm" }>["key"];
export type UserAgentDimension = Extract<Dimension, { group: "ua" }>["key"];

export function isUtmDimension(
	dimension: Dimension,
): dimension is Extract<Dimension, { group: "utm" }> {
	return dimension.group === "utm";
}

export function dimensionValue(
	empty: DimensionEmptyPolicy,
	raw: string | null | undefined,
): string | null {
	switch (empty) {
		case "omit":
			return raw ? raw : null;
		case "unknown":
			return raw ?? "Unknown";
		default: {
			const _exhaustive: never = empty;
			throw new Error(`Unhandled dimension empty policy: ${_exhaustive}`);
		}
	}
}

export function startOfUtcDay(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}
