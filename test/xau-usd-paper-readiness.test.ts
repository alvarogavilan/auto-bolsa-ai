import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/index-paper-capital.ts", "utf8");

describe("XAU/USD PAPER readiness endpoint", () => {
  it("exposes feed and cron diagnostics without enabling LIVE", () => {
    expect(source).toContain('path === "/api/xau/readiness"');
    expect(source).toContain('schemaVersion: "xau-usd-paper-readiness-v1"');
    expect(source).toContain('cron: "*/5 * * * *"');
    expect(source).toContain("feedConfigured");
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrderSubmission: false");
  });

  it("reports a concrete blocker when the external feed is missing", () => {
    expect(source).toContain("Falta configurar XAU_PAPER_FEED_URL");
    expect(source).toContain('feedStatus: feedConfigured ? "configured" : "missing"');
  });
});
