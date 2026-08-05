import { describe, expect, it } from "vitest";
import { calculateXauPaperBudget } from "../src/xau-usd-paper-runtime";
import type { XauCabinetDecision, XauCabinetInput } from "../src/xau-usd-specialist-cabinet";

const cabinet: XauCabinetInput = {
  symbol: "XAU/USD",
  session: "london",
  technical: {
    trendBias: "long",
    marketStructureBias: "long",
    liquidityBias: "long",
    momentumBias: "long",
    volatilityPct: 0.7,
    spreadPct: 0.02,
    distanceToInvalidationPct: 0.5,
    projectedMovePct: 1.5,
  },
  macro: {
    dxyBiasForGold: "long",
    realYieldsBiasForGold: "long",
    centralBankBias: "long",
    inflationBias: "long",
    geopoliticalBias: "long",
    highImpactEventWithinMinutes: null,
    sourcesAvailable: 5,
    sourcesFresh: 5,
  },
  openXauExposureEur: 0,
  paperEquityEur: 100,
};

function decision(consensusPct: number, riskRegime: XauCabinetDecision["riskRegime"]): XauCabinetDecision {
  return {
    schemaVersion: "xau-usd-specialist-cabinet-v1",
    symbol: "XAU/USD",
    allowed: true,
    bias: "long",
    consensusPct,
    riskRegime,
    votes: [],
    vetoes: [],
    reasons: [],
    liveTrading: false,
  };
}

describe("XAU PAPER dynamic sizing", () => {
  it("allocates more to stronger normal-regime signals without exceeding the requested maximum", () => {
    const strong = calculateXauPaperBudget({ requestedBudgetEur: 30, cabinet }, decision(100, "normal"), 4);
    const weaker = calculateXauPaperBudget({ requestedBudgetEur: 30, cabinet }, decision(75, "normal"), 2);
    expect(strong.selectedBudgetEur).toBeGreaterThan(weaker.selectedBudgetEur);
    expect(strong.selectedBudgetEur).toBeLessThanOrEqual(30);
  });

  it("reduces exposure in elevated volatility", () => {
    const normal = calculateXauPaperBudget({ requestedBudgetEur: 30, cabinet }, decision(90, "normal"), 3);
    const elevated = calculateXauPaperBudget({ requestedBudgetEur: 30, cabinet }, decision(90, "elevated"), 3);
    expect(elevated.selectedBudgetEur).toBeLessThan(normal.selectedBudgetEur);
  });

  it("honours aggregate XAU exposure headroom and never enables LIVE", () => {
    const constrainedCabinet = { ...cabinet, openXauExposureEur: 28 };
    const sizing = calculateXauPaperBudget({ requestedBudgetEur: 30, cabinet: constrainedCabinet }, decision(100, "normal"), 4);
    expect(sizing.exposureHeadroomEur).toBe(2);
    expect(sizing.selectedBudgetEur).toBe(2);
    expect(sizing.rationale.join(" ")).toContain("LIVE y órdenes reales permanecen desactivados");
  });
});