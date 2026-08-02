import { describe, expect, it } from "vitest";
import {
  EARLY_NEGATIVE_PATTERN_LOSS_STREAK,
  evaluateNegativePatternVeto,
  MIN_NEGATIVE_PATTERN_SAMPLE,
} from "../src/paper-negative-pattern-veto";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";

function makeStrategy(closedTrades = 5): LabStrategyState {
  const trades: any[] = [];
  for (let index = 0; index < closedTrades; index += 1) {
    trades.push({ id: `buy-${index}`, side: "buy", timestamp: 1_000 + index * 10_000, price: 100, quantity: 0.05, grossEur: 5, feeEur: 0.02, reason: "Cruce confirmado", evidenceVersion: "paper-trade-evidence-v1", estimatedSlippageEur: 0.005, stopLoss: 98.8, takeProfit: 102.4, indicators: null });
    trades.push({ id: `sell-${index}`, side: "sell", timestamp: 2_000 + index * 10_000, price: 98, quantity: 0.05, grossEur: 4.9, feeEur: 0.0196, reason: "Stop loss", pnlEur: -0.1396, evidenceVersion: "paper-trade-evidence-v1", linkedEntryTradeId: `buy-${index}`, estimatedSlippageEur: 0.0049, totalCostsEur: 0.0495, grossPnlBeforeCostsEur: -0.0901, durationMinutes: 1, diagnosis: "loser" });
  }
  return {
    id: "fast:XBT/EUR", lane: "fast", pairKey: "XXBTZEUR", symbol: "XBT/EUR", base: "XBT", status: "active",
    initialCashEur: 100, cashEur: 100, equityEur: 100, peakEquityEur: 100, maxDrawdownPct: 0, position: null,
    config: { id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7, buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct: 0.012, takeProfitPct: 0.024, cooldownMinutes: 20, maximumHoldingMinutes: 180, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 1, estimatedTakerRoundTripCostPct: 0.01, lastClosedCandleTime: 1, lastAttemptAt: 1, lastSuccessfulAt: 1, nextDueAt: 2, lastTradeAt: 1, lastDecision: "test", cycles: 1, uniqueCandles: 1, duplicateSkips: 0, errors: 0, consecutiveErrors: 0, lastError: null,
    performance: { buys: closedTrades, sells: closedTrades, closedTrades, winningTrades: 0, losingTrades: closedTrades, grossProfitEur: 0, grossLossEur: 0.1396 * closedTrades, netPnlEur: -0.1396 * closedTrades, totalFeesEur: 0.0396 * closedTrades }, trades,
  };
}

function state(strategy: LabStrategyState): ResearchLabState {
  return { schemaVersion: "multi-horizon-paper-lab-v1", version: "0.17.0-paper", mode: "paper", initializedAt: 1, cohortLockedUntil: 2, sourceUniverseGeneratedAt: 1, lastCycleAt: 1, cycles: 1, strategies: [strategy], liveTrading: false };
}

function candidate(reason = "Cruce confirmado") {
  return { id: "new", side: "buy" as const, timestamp: 100_000, price: 100, quantity: 0.05, grossEur: 5, feeEur: 0.02, reason };
}

describe("negative PAPER pattern veto", () => {
  it("blocks statistically after five complete evidenced losses for the exact pattern", () => {
    const strategy = makeStrategy(5);
    const result = evaluateNegativePatternVeto(strategy, state(strategy), candidate());
    expect(MIN_NEGATIVE_PATTERN_SAMPLE).toBe(5);
    expect(result.blocked).toBe(true);
    expect(result.trigger).toBe("statistical-negative-pattern");
    expect(result.sampleSize).toBe(5);
    expect(result.consecutiveLosses).toBe(5);
    expect(result.netPnlEur).toBeLessThan(0);
    expect(result.profitFactor).toBe(0);
    expect(result.liveTrading).toBe(false);
  });

  it("activates an early safety brake after three consecutive losses of the exact pattern", () => {
    const strategy = makeStrategy(3);
    const result = evaluateNegativePatternVeto(strategy, state(strategy), candidate());
    expect(EARLY_NEGATIVE_PATTERN_LOSS_STREAK).toBe(3);
    expect(result.blocked).toBe(true);
    expect(result.trigger).toBe("early-loss-streak");
    expect(result.sampleSize).toBe(3);
    expect(result.consecutiveLosses).toBe(3);
  });

  it("does not block before the early loss threshold", () => {
    const strategy = makeStrategy(2);
    const result = evaluateNegativePatternVeto(strategy, state(strategy), candidate());
    expect(result.blocked).toBe(false);
    expect(result.trigger).toBe("none");
    expect(result.consecutiveLosses).toBe(2);
  });

  it("does not block a different entry reason", () => {
    const strategy = makeStrategy();
    const result = evaluateNegativePatternVeto(strategy, state(strategy), candidate("Ruptura confirmada"));
    expect(result.blocked).toBe(false);
    expect(result.sampleSize).toBe(0);
  });
});
