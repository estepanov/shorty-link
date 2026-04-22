import { describe, expect, it } from "vitest";

import {
  buildAnalyticsTarget,
  buildRedirectTarget,
  extractUtmParams,
  normalizeHostname,
  normalizeSlug,
  normalizeTargetUrl,
} from "../src/server/services/links";

describe("redirect behavior", () => {
  it("normalizes hostnames, slugs, and target urls", () => {
    expect(normalizeHostname("https://Go.Example.com/path")).toBe("go.example.com");
    expect(normalizeSlug("  Launch Page! ")).toBe("launch-page");
    expect(normalizeTargetUrl("example.com/pricing")).toBe("https://example.com/pricing");
  });

  it("merges incoming query params without overriding destination params", () => {
    expect(
      buildRedirectTarget(
        "https://example.com/path?source=configured",
        "https://go.example.com/deal?source=incoming&utm_campaign=spring",
        true,
      ),
    ).toBe("https://example.com/path?source=configured&utm_campaign=spring");
  });

  it("extracts UTM params from the incoming request URL", () => {
    const utm = extractUtmParams(
      "https://go.example.com/slug?utm_source=newsletter&utm_medium=email&other=1",
    );

    expect(utm.utmSource).toBe("newsletter");
    expect(utm.utmMedium).toBe("email");
    expect(utm.utmCampaign).toBeNull();
    expect(utm.utmTerm).toBeNull();
    expect(utm.utmContent).toBeNull();
  });

  it("limits analytics query persistence to UTM keys", () => {
    expect(
      buildAnalyticsTarget(
        "https://example.com/path?existing=true",
        "https://go.example.com/deal?utm_source=newsletter&token=secret",
        true,
      ),
    ).toBe("https://example.com/path?existing=true&utm_source=newsletter");
  });
});
