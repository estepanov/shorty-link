export type ParsedRedirectUserAgent = {
	browser: string;
	os: string;
	deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
	isBot: boolean;
};

const UNKNOWN_USER_AGENT: ParsedRedirectUserAgent = {
	browser: "Unknown",
	os: "Unknown",
	deviceType: "unknown",
	isBot: false,
};

const botPattern =
	/bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|duckduckgo|embedly|quora link preview|showyoubot|outbrain|pinterest|developers\.google\.com\/\+\/web\/snippet|vkshare|w3c_validator|redditbot|applebot|whatsapp|flipboard|tumblr|bitlybot|skypeuripreview|nuzzel|discordbot|google page speed|qwantify|pinterestbot|bitrix link preview|xing-contenttabreceiver|chrome-lighthouse|telegrambot/i;

export function parseRedirectUserAgent(
	userAgent: string | null | undefined,
): ParsedRedirectUserAgent {
	const value = userAgent?.trim();
	if (!value) {
		return UNKNOWN_USER_AGENT;
	}

	const isBot = botPattern.test(value);
	const browser = detectBrowser(value);
	const os = detectOs(value);

	return {
		browser,
		os,
		deviceType: isBot ? "bot" : detectDeviceType(value),
		isBot,
	};
}

function detectBrowser(userAgent: string) {
	if (/Edg\//.test(userAgent)) {
		return "Edge";
	}
	if (/OPR\/|Opera\//.test(userAgent)) {
		return "Opera";
	}
	if (/SamsungBrowser\//.test(userAgent)) {
		return "Samsung Internet";
	}
	if (/Firefox\//.test(userAgent) && !/Seamonkey\//.test(userAgent)) {
		return "Firefox";
	}
	if (
		/CriOS\/|Chrome\/|Chromium\//.test(userAgent) &&
		!/Edg\//.test(userAgent)
	) {
		return "Chrome";
	}
	if (
		/Safari\//.test(userAgent) &&
		!/Chrome\/|Chromium\/|CriOS\//.test(userAgent)
	) {
		return "Safari";
	}
	return "Other";
}

function detectOs(userAgent: string) {
	if (/Android/.test(userAgent)) {
		return "Android";
	}
	if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) {
		return "iOS";
	}
	if (/Windows NT/.test(userAgent)) {
		return "Windows";
	}
	if (/CrOS/.test(userAgent)) {
		return "ChromeOS";
	}
	if (/Mac OS X|Macintosh/.test(userAgent)) {
		return "macOS";
	}
	if (/Linux|X11/.test(userAgent)) {
		return "Linux";
	}
	return "Other";
}

function detectDeviceType(
	userAgent: string,
): ParsedRedirectUserAgent["deviceType"] {
	if (/iPad|Tablet|Nexus 7|Nexus 9|SM-T|Kindle|Silk/i.test(userAgent)) {
		return "tablet";
	}
	if (/Mobile|iPhone|iPod|Android.*Mobi|Windows Phone/i.test(userAgent)) {
		return "mobile";
	}
	if (/Windows NT|Macintosh|Mac OS X|Linux|X11|CrOS/i.test(userAgent)) {
		return "desktop";
	}
	return "unknown";
}
