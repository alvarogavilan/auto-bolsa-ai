import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/index-paper-capital.ts", "utf8");

describe("XAU/USD PAPER readiness endpoint", () => {
  it("exposes fast price monitoring without enabling LIVE", () => {
    expect(source).toContain('path === "/api/xau/readiness"');
    expect(source).toContain('schemaVersion: "xau-usd-paper-readiness-v6"');
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
  });

  it("separates monitoring samples from real decision outcomes", () => {
    expect(source).toContain("latestXauDecisionCycle");
    expect(source).toContain('cycleKind !== "monitoring"');
    expect(source).toContain("decisionCycles");
    expect(source).toContain("monitoringSamples");
    expect(source).toContain("approvedDecisionCycles: approved");
    expect(source).toContain("blockedDecisionCycles: blocked");
    expect(source).toContain("latestDecisionOutcome");
    expect(source).toContain("latestDecisionBlockers");
    expect(source).toContain('blockers: latestDecisionOutcome === "blocked" ? latestDecisionBlockers : []');
  });

  it("aggregates the dominant blocker from recent real decisions", () => {
    expect(source).toContain("XAU_BLOCKER_DIAGNOSTIC_WINDOW = 50");
    expect(source).toContain("xauBlockerDiagnostics");
    expect(source).toContain("dominantBlocker");
    expect(source).toContain("dominantBlockerCount");
    expect(source).toContain("blockerFrequency");
    expect(source).toContain("blockerDiagnostics,");
  });
});
