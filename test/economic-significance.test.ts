import { describe, expect, it } from "vitest";
import { buildEconomicSignificanceReport, minimumMeaningfulWinEur } from "../src/economic-significance";
import type { ResearchLabState } from "../src/research-lab";

function stateWithPnls(pnls: number[]): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: 1,
    cohortLockedUntil: 2,
    sourceUniverseGeneratedAt: 1,
    lastCycleAt: 1,
    cycles: 1,
    liveTrading: false,
    strategies: [{
      id: "fast:XBT/EUR",
      lane: "fast",
      pairKey: "XBT/EUR",
      symbol: "XBT/EUR",
      base: "XBT",
      status: "active",
      initialCashEur: 50,
      cashEur: 50,
      equityEur: 50,
      peakEquityEur: 50,
      maxDrawdownPct: 0,
      position: null,
      config: {
        id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7,
        buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct: 0.012,
        takeProfitPct: 0.024, cooldownMinutes: 20, maximumHoldingMinutes: 180,
        feePctEachSide: 0.004, slippagePctEachSide: 0.001,
      },
      estimatedOrderMinimumEur: 1,
      estimatedTakerRoundTripCostPct: 0.01,
      lastClosedCandleTime: 1,
      lastAttemptAt: 1,
      lastSuccessfulAt: 1,
      nextDueAt: 2,
      lastTradeAt: 1,
      lastDecision: "test",
      cycles: 1,
      uniqueCandles: 1,
      duplicateSkips: 0,
      errors: 0,
      consecutiveErrors: 0,
      lastError: null,
      performance: { buys: 0, sells: pnls.length, closedTrades: pnls.length, winningTrades: pnls.filter((p) => p > 0).length, losingTrades: pnls.filter((p) => p < 0).length, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
      trades: pnls.map((pnl, index) => ({ id: String(index), side: "sell" as const, timestamp: index + 1, price: 1, quantity: 1, grossEur: 1, feeEur: 0, reason: "test", pnlEur: pnl })),
    }],
  };
}

describe("economic significance department", () => {
  it("does not treat microscopic positive closes as meaningful evidence", () => {
    const report = buildEconomicSignificanceReport(stateWithPnls([0.000028, 0.06, -0.2]), 10);
    expect(report.minimumMeaningfulWinEur).toBe(0.1);
    expect(report.meaningfulWins).toBe(0);
    expect(report.microWins).toBe(2);
    expect(report.losses).toBe(1);
    expect(report.warning).toContain("no deben interpretarse como evidencia");
    expect(report.liveTrading).toBe(false);
  });

  it("scales the meaningful floor without forcing unsafe one-euro targets", () => {
    expect(minimumMeaningfulWinEur(50)).toBe(0.1);
    expect(minimumMeaningfulWinEur(500)).toBe(1);
    expect(minimumMeaningfulWinEur(5_000)).toBe(1);
  });
});
