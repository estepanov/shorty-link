export const ANALYTICS_AGGREGATION_STATE_ID = "default";

export const UTM_DIMENSIONS = [
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmTerm",
	"utmContent",
] as const;

export type UtmDimension = (typeof UTM_DIMENSIONS)[number];

export const USER_AGENT_DIMENSIONS = ["browser", "os", "deviceType"] as const;

export type UserAgentDimension = (typeof USER_AGENT_DIMENSIONS)[number];

export const UTM_EVENT_FIELDS = {
	utmSource: "utmSource",
	utmMedium: "utmMedium",
	utmCampaign: "utmCampaign",
	utmTerm: "utmTerm",
	utmContent: "utmContent",
} as const satisfies Record<UtmDimension, string>;

export const USER_AGENT_EVENT_FIELDS = {
	browser: "userAgentBrowser",
	os: "userAgentOs",
	deviceType: "userAgentDeviceType",
} as const satisfies Record<UserAgentDimension, string>;

export function startOfUtcDay(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}
