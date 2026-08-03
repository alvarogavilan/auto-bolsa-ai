import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/index-paper-capital.ts", "utf8");

describe("XAU/USD PAPER readiness endpoint", () => {
  it("exposes fast price monitoring without enabling LIVE", () => {
    expect(source).toContain('path === "/api/xau/readiness"');
    expect(source).toContain('schemaVersion: "xau-usd-paper-readiness-v3"');
    expect(source).toContain('schedulerCron: "* * * * *"');
    expect(source).toContain("priceMonitoringIntervalSeconds");
    expect(source).toContain("baseStrategyCycleMinutes: 5");
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrderSubmission: false");
  });

  it("keeps new entries blocked when macro evidence is missing", () => {
    expect(source).toContain("mantienen veto PAPER");
    expect(source).toContain("DXY, rendimientos reales y calendario macro frescos");
    expect(source).toContain('tradingReady: externalFeedConfigured');
  });
});
