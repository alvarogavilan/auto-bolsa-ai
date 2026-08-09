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

  it("reports current feed health and only advertises a full profile when macro is really fresh", () => {
    expect(source).toContain("xauFeedDiagnostic");
    expect(source).toContain("macroSourcesAvailable");
    expect(source).toContain("macroSourcesFresh");
    expect(source).toContain('entryProfile: externalFeedConfigured || macroReady ? "full-technical-macro" : "strict-technical-paper-fallback"');
    expect(source).toContain("paperEntryCapable: feedDiagnostic.ok");
    expect(source).toContain("Unanimidad técnica 100 %");
    expect(source).toContain("spread <= 0,05 %");
    expect(source).toContain("asimetría >= 2,5R");
  });

  it("detects a scheduler that stopped persisting decisions", () => {
    expect(source).toContain("XAU_SCHEDULER_STALE_MS = 3 * 60_000");
    expect(source).toContain("latestDecisionObservedAt");
    expect(source).toContain("latestDecisionAgeMs");
    expect(source).toContain("schedulerStalled");
    expect(source).toContain("XAU_SCHEDULER_STALLED");
    expect(source).toContain("operational: feedDiagnostic.ok && !schedulerStalled");
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
    expect(source).toContain("latestDecisionOutcome === \"blocked\" ? latestDecisionBlockers : []");
    expect(source).toContain("runtimeBlockers");
  });

  it("isolates scheduled failures so one subsystem cannot suppress all later XAU monitoring", () => {
    expect(source).toContain('console.error("BASE_STRATEGY_SCHEDULED_FAILURE"');
    expect(source).toContain('console.error("XAU_DECISION_SCHEDULED_FAILURE"');
    expect(source).toContain('console.error("XAU_PAXG_SCHEDULED_FAILURE"');
    const decision = source.indexOf("await runXauDecisionCycle(runtimeEnv)");
    const monitoring = source.indexOf("ctx.waitUntil(runXauFastMonitoringSamples(runtimeEnv))");
    expect(decision).toBeGreaterThan(-1);
    expect(monitoring).toBeGreaterThan(decision);
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
