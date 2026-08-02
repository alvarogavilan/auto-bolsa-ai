import { describe, expect, it } from "vitest";
import { paperLossRecoveryBlocker, type AppliedIntelligenceContext } from "../src/research-lab-adaptive";
import type { LabStrategyState } from "../src/research-lab";

function strategyWithLosses(losses: number, roundTripCostPct = 0.008): LabStrategyState {
  return {
    lane: "intraday",
    estimatedTakerRoundTripCostPct: roundTripCostPct,
    config: { takeProfitPct: 0.04 },
    trades: Array.from({ length: losses }, (_, index) => ({
      id: `sell-${index}`,
      side: "sell" as const,
      timestamp: Date.now() - index * 60_000,
      price: 100,
      quantity: 0.1,
      grossEur: 10,
      feeEur: 0.04,
      reason: "Prueba",
      pnlEur: -0.05,
    })),
  } as LabStrategyState;
}

function intelligence(trend: "bullish" | "bearish" | "sideways", sizeFactor: number): AppliedIntelligenceContext {
  return {
    news: { vetoNewLong: false, sizeFactor: 1, relevantSignals: 0 } as AppliedIntelligenceContext["news"],
    chart: {
      schemaVersion: "chart-intelligence-v1",
      trend,
      momentum: trend === "bullish" ? 0.01 : 0,
      volatilityPct: 0.01,
      support: 90,
      resistance: 110,
      confidence: 0.9,
      sizeFactor,
      vetoNewLong: trend === "bearish",
      reasons: [],
      liveTrading: false,
    },
  };
}

describe("PAPER loss recovery gate", () => {
  it("blocks ordinary entries after four consecutive losses", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(4), intelligence("sideways", 0.7))).toContain("modo recuperación");
  });

  it("allows an exceptional bullish and cost-efficient setup after four losses", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(4), intelligence("bullish", 1.05))).toBeNull();
  });

  it("uses a stricter cost threshold after eight losses without a win", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(8, 0.016), intelligence("bullish", 1.1))).toContain("modo recuperación");
  });
});
