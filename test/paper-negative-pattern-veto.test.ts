import { describe, expect, it } from "vitest";
import { evaluateNegativePatternVeto, MIN_NEGATIVE_PATTERN_SAMPLE } from "../src/paper-negative-pattern-veto";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";

function makeStrategy(): LabStrategyState {
  const trades: any[] = [];
  for (let index = 0; index < 5; index += 1) {
    trades.push({ id: `buy-${index}`, side: "buy", timestamp: 1_000 + index * 10_000, price: 100, quantity: 0.05, grossEur: 5, feeEur: 0.02, reason: "Cruce confirmado", evidenceVersion: "paper-trade-evidence-v1", estimatedSlippageEur: 0.005, stopLoss: 98.8, takeProfit: 102.4, indicators: null });
    trades.push({ id: `sell-${index}`, side: "sell", timestamp: 2_000 + index * 10_000, price: 98, quantity: 0.05, grossEur: 4.9, feeEur: 0.0196, reason: "Stop loss", pnlEur: -0.1396, evidenceVersion: "paper-trade-evidence-v1", linkedEntryTradeId: `buy-${index}`, estimatedSlippageEur: 0.0049, totalCostsEur: 0.0495, grossPnlBeforeCostsEur: -0.0901, durationMinutes: 1, diagnosis: "loser" });
  }
  return {
    id: "fast:XBT/EUR", lane: "fast", pairKey: "XXBTZEUR", symbol: "XBT/EUR", base: "XBT", status: "active",
    initialCashEur: 100, cashEur: 100, equityEur: 100, peakEquityEur: 100, maxDrawdownPct: 0, position: null,
    config: { id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7, buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct: 0.012, takeProfitPct: 0.024, cooldownMinutes: 20, maximumHoldingMinutes: 180, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 1, estimatedTakerRoundTripCostPct: 0.01, lastClosedCandleTime: 1, lastAttemptAt: 1, lastSuccessfulAt: 1, nextDueAt: 2, lastTradeAt: 1, lastDecision: "test", cycles: 1, uniqueCandles: 1, duplicateSkips: 0, errors: 0, consecutiveErrors: 0, lastError: null,
    performance: { buys: 5, sells: 5, closedTrades: 5, winningTrades: 0, losingTrades: 5, grossProfitEur: 0, grossLossEur: 0.698, netPnlEur: -0.698, totalFeesEur: 0.198 }, trades,
  };
}

function state(strategy: LabStrategyState): ResearchLabState {
  return { schemaVersion: "multi-horizon-paper-lab-v1", version: "0.17.0-paper", mode: "paper", initializedAt: 1, cohortLockedUntil: 2, sourceUniverseGeneratedAt: 1, lastCycleAt: 1, cycles: 1, strategies: [strategy], liveTrading: false };
}

describe("negative PAPER pattern veto", () => {
  it("blocks only after five complete evidenced losses for the same lane, symbol and entry reason", () => {
    const strategy = makeStrategy();
    const result = evaluateNegativePatternVeto(strategy, state(strategy), { id: "new", side: "buy", timestamp: 100_000, price: 100, quantity: 0.05, grossEur: 5, feeEur: 0.02, reason: "Cruce confirmado" });
    expect(MIN_NEGATIVE_PATTERN_SAMPLE).toBe(5);
    expect(result.blocked).toBe(true);
    expect(result.sampleSize).toBe(5);
    expect(result.netPnlEur).toBeLessThan(0);
    expect(result.profitFactor).toBe(0);
    expect(result.liveTrading).toBe(false);
  });

  it("does not block a different entry reason", () => {
    const strategy = makeStrategy();
    const result = evaluateNegativePatternVeto(strategy, state(strategy), { id: "new", side: "buy", timestamp: 100_000, price: 100, quantity: 0.05, grossEur: 5, feeEur: 0.02, reason: "Ruptura confirmada" });
    expect(result.blocked).toBe(false);
    expect(result.sampleSize).toBe(0);
  });
});
