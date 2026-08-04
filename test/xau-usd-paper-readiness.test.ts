import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/index-paper-capital.ts", "utf8");

describe("XAU/USD PAPER readiness endpoint", () => {
  it("exposes fast price monitoring without enabling LIVE", () => {
    expect(source).toContain('path === "/api/xau/readiness"');
    expect(source).toContain('schemaVersion: "xau-usd-paper-readiness-v4"');
    expect(source).toContain('schedulerCron: "* * * * *"');
    expect(source).toContain("priceMonitoringIntervalSeconds");
    expect(source).toContain("baseStrategyCycleMinutes: 5");
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrderSubmission: false");
  });

  it("reports the strict technical PAPER fallback as entry-capable", () => {
    expect(source).toContain('entryProfile: externalFeedConfigured ? "full-technical-macro" : "strict-technical-paper-fallback"');
    expect(source).toContain("paperEntryCapable: true");
    expect(source).toContain("Unanimidad técnica 100 %");
    expect(source).toContain("spread <= 0,05 %");
    expect(source).toContain("asimetría >= 2,5R");
    expect(source).not.toContain("tradingReady: externalFeedConfigured");
  });

  it("surfaces the latest real cycle outcome and blockers", () => {
    expect(source).toContain("approvedCycles: approved");
    expect(source).toContain("blockedCycles: blocked");
    expect(source).toContain("latestOutcome");
    expect(source).toContain("latestBlockers");
    expect(source).toContain('blockers: latestOutcome === "blocked" ? latestBlockers : []');
  });
});
