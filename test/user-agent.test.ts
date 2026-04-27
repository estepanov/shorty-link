import { describe, expect, it } from "vitest";

import { parseRedirectUserAgent } from "../src/server/services/user-agent";

describe("redirect user-agent parsing", () => {
	it("classifies common desktop browsers", () => {
		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toMatchObject({
			browser: "Chrome",
			deviceType: "desktop",
			isBot: false,
			os: "Windows",
		});

		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
			),
		).toMatchObject({
			browser: "Safari",
			deviceType: "desktop",
			os: "macOS",
		});

		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
			),
		).toMatchObject({
			browser: "Firefox",
			deviceType: "desktop",
			os: "Windows",
		});

		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			),
		).toMatchObject({
			browser: "Edge",
			deviceType: "desktop",
			os: "Windows",
		});
	});

	it("classifies mobile and tablet devices", () => {
		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			),
		).toMatchObject({
			browser: "Safari",
			deviceType: "mobile",
			os: "iOS",
		});

		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			),
		).toMatchObject({
			browser: "Chrome",
			deviceType: "mobile",
			os: "Android",
		});

		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			),
		).toMatchObject({
			browser: "Safari",
			deviceType: "tablet",
			os: "iOS",
		});
	});

	it("classifies bots separately from browser-like user agents", () => {
		expect(
			parseRedirectUserAgent(
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36",
			),
		).toMatchObject({
			browser: "Chrome",
			deviceType: "bot",
			isBot: true,
		});
	});

	it("uses unknown labels for missing user agents", () => {
		expect(parseRedirectUserAgent(null)).toEqual({
			browser: "Unknown",
			deviceType: "unknown",
			isBot: false,
			os: "Unknown",
		});
	});
});
