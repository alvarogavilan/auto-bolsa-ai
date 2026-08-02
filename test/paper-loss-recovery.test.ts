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

function intelligence(
  trend: "bullish" | "bearish" | "sideways",
  sizeFactor: number,
  timeframeAgreementPct = trend === "bullish" ? 1 : 0.5,
  breakoutConfirmed = trend === "bullish",
): AppliedIntelligenceContext {
  return {
    news: { vetoNewLong: false, sizeFactor: 1, relevantSignals: 0 } as AppliedIntelligenceContext["news"],
    chart: {
      schemaVersion: "chart-intelligence-v2",
      trend,
      regime: trend === "sideways" ? "range" : "trend",
      momentum: trend === "bullish" ? 0.01 : 0,
      volatilityPct: 0.01,
      support: 90,
      resistance: 110,
      confidence: 0.9,
      sizeFactor,
      vetoNewLong: trend === "bearish",
      breakoutConfirmed,
      timeframeAgreementPct,
      timeframes: [],
      reasons: [],
      liveTrading: false,
    },
  };
}

describe("PAPER loss recovery gate", () => {
  it("activates the brake after two consecutive losses", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(2), intelligence("sideways", 0.7))).toContain("freno PAPER");
  });

  it("does not brake before the second consecutive loss", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(1), intelligence("sideways", 0.7))).toBeNull();
  });

  it("requires a confirmed breakout and strong timeframe agreement during recovery", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(2), intelligence("bullish", 1.05, 0.6, true))).toContain("freno PAPER");
    expect(paperLossRecoveryBlocker(strategyWithLosses(2), intelligence("bullish", 1.05, 0.9, false))).toContain("freno PAPER");
  });

  it("allows only an exceptional bullish and cost-efficient setup after two losses", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(2), intelligence("bullish", 1.05, 0.9, true))).toBeNull();
  });

  it("becomes stricter after four losses without a win", () => {
    expect(paperLossRecoveryBlocker(strategyWithLosses(4, 0.01), intelligence("bullish", 1.05, 0.95, true))).toContain("freno PAPER");
    expect(paperLossRecoveryBlocker(strategyWithLosses(4, 0.006), intelligence("bullish", 1.12, 0.95, true))).toBeNull();
  });
});
