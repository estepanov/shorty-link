import { describe, expect, it } from "vitest";

import {
	createTranslator,
	interpolate,
	messages,
	normalizeLocale,
} from "@/lib/i18n";

describe("i18n", () => {
	it("keeps locale keys in parity", () => {
		expect(Object.keys(messages.es).sort()).toEqual(
			Object.keys(messages.en).sort(),
		);
	});

	it("normalizes locales and falls back safely", () => {
		expect(normalizeLocale("ES-MX,en;q=0.8")).toBe("es");
		expect(createTranslator("fr")("nav.dashboard")).toBe("Dashboard");
		expect(createTranslator("es")("missing.message")).toBe("missing.message");
	});

	it("interpolates provided variables and preserves missing placeholders", () => {
		expect(
			interpolate("Hello {{name}}, {{count}} links", { name: "Ada" }),
		).toBe("Hello Ada, {{count}} links");
	});
});
