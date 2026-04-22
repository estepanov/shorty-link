import { describe, expect, it } from "vitest";

import {
  buildAnalyticsTarget,
  buildRedirectTarget,
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
