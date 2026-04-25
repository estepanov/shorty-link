import { describe, expect, it } from "vitest";

import { formatApiKeyPreview } from "../src/lib/api-keys";

describe("formatApiKeyPreview", () => {
	it("does not duplicate a stored key prefix in the visible start", () => {
		expect(
			formatApiKeyPreview({
				prefix: "sl_",
				start: "sl_Ypj",
			}),
		).toBe("sl_Ypj");
	});

	it("adds the prefix when the visible start omits it", () => {
		expect(
			formatApiKeyPreview({
				prefix: "sl_",
				start: "Ypj",
			}),
		).toBe("sl_Ypj");
	});

	it("falls back to a masked prefix preview", () => {
		expect(
			formatApiKeyPreview({
				prefix: "sl_",
				start: null,
			}),
		).toBe("sl_••••");
	});
});
