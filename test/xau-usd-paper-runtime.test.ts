import { describe, expect, it } from "vitest";
import { buildXauUsdPaperInstruction, type XauPaperRuntimeInput } from "../src/xau-usd-paper-runtime";

function healthyInput(): XauPaperRuntimeInput {
  const now = 10_000;
  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid: 2400, ask: 2400.4, observedAt: now - 2_000, source: "paper-feed" },
    cabinet: {
      symbol: "XAU/USD",
      session: "overlap",
      technical: {
        trendBias: "long",
        marketStructureBias: "long",
        liquidityBias: "long",
        momentumBias: "long",
        volatilityPct: 0.8,
        spreadPct: 0.02,
        distanceToInvalidationPct: 0.4,
        projectedMovePct: 1.2,
      },
      macro: {
        dxyBiasForGold: "long",
        realYieldsBiasForGold: "long",
        centralBankBias: "long",
        inflationBias: "long",
        geopoliticalBias: "long",
        highImpactEventWithinMinutes: 90,
        sourcesAvailable: 6,
        sourcesFresh: 6,
      },
      openXauExposureEur: 0,
      paperEquityEur: 100,
    },
  };
}

describe("XAU/USD PAPER runtime", () => {
  it("converts an approved cabinet decision into an auditable PAPER instruction", () => {
    const instruction = buildXauUsdPaperInstruction(healthyInput());
    expect(instruction.allowed).toBe(true);
    expect(instruction.action).toBe("buy");
    expect(instruction.budgetEur).toBe(instruction.sizing.selectedBudgetEur);
    expect(instruction.budgetEur).toBe(6);
    expect(instruction.sizing.requestedMaximumEur).toBe(10);
    expect(instruction.sizing.rationale.length).toBeGreaterThan(0);
    expect(instruction.referencePrice).toBe(2400.4);
    expect(instruction.stopPrice).toBeLessThan(instruction.referencePrice as number);
    expect(instruction.initialTargetPrice).toBeGreaterThan(instruction.referencePrice as number);
    expect(instruction.rewardRisk).toBe(3);
    expect(instruction.mode).toBe("paper");
    expect(instruction.liveTrading).toBe(false);
    expect(instruction.realOrderSubmission).toBe(false);
  });

  it("blocks stale quotes rather than inventing an executable price", () => {
    const input = healthyInput();
    input.quote.observedAt = input.now - 20_000;
    const instruction = buildXauUsdPaperInstruction(input);
    expect(instruction.allowed).toBe(false);
    expect(instruction.action).toBe("hold");
    expect(instruction.referencePrice).toBeNull();
    expect(instruction.blockers.join(" ")).toContain("caducada");
  });

  it("blocks imminent macro events even with a fresh quote and aligned chart", () => {
    const input = healthyInput();
    input.cabinet.macro.highImpactEventWithinMinutes = 5;
    const instruction = buildXauUsdPaperInstruction(input);
    expect(instruction.allowed).toBe(false);
    expect(instruction.blockers.join(" ")).toContain("evento macro");
  });

  it("enforces the minimum and caps the requested maximum at 30 euros", () => {
    const micro = healthyInput();
    micro.requestedBudgetEur = 4;
    expect(buildXauUsdPaperInstruction(micro).allowed).toBe(false);

    const oversized = healthyInput();
    oversized.requestedBudgetEur = 50;
    const instruction = buildXauUsdPaperInstruction(oversized);
    expect(instruction.allowed).toBe(true);
    expect(instruction.sizing.requestedMaximumEur).toBe(30);
    expect(instruction.budgetEur).toBe(18);
    expect(instruction.budgetEur).toBeLessThanOrEqual(30);
  });
});
