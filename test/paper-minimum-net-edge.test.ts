import { describe, expect, it } from "vitest";
import { evaluatePaperMinimumNetEdge } from "../src/paper-minimum-net-edge";
import { evaluateTreasuryEntry } from "../src/treasury-risk";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";

function strategy(takeProfitPct = 0.08, roundTripCostPct = 0.01, stopLossPct = 0.02): LabStrategyState {
  return {
    id: "fast:XBT/EUR",
    lane: "fast",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 100,
    cashEur: 100,
    equityEur: 100,
    peakEquityEur: 100,
    maxDrawdownPct: 0,
    position: null,
    config: { id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7, buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct, takeProfitPct, cooldownMinutes: 20, maximumHoldingMinutes: 180, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: roundTripCostPct,
    lastClosedCandleTime: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextDueAt: 0,
    lastTradeAt: null,
    lastDecision: "test",
    cycles: 0,
    uniqueCandles: 0,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: 0, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
    trades: [],
  };
}

function state(item: LabStrategyState): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: 1,
    cohortLockedUntil: 2,
    sourceUniverseGeneratedAt: 1,
    lastCycleAt: 1,
    cycles: 1,
    strategies: [item],
    liveTrading: false,
  };
}

describe("minimum PAPER net edge", () => {
  it("allows only a materially larger expected move after costs and risk", () => {
    const item = strategy(0.08, 0.01, 0.02);
    const edge = evaluatePaperMinimumNetEdge(item, 5);

    expect(edge.allowed).toBe(true);
    expect(edge.expectedGrossProfitEur).toBeCloseTo(0.4, 6);
    expect(edge.expectedRoundTripCostsEur).toBeCloseTo(0.05, 6);
    expect(edge.expectedNetProfitEur).toBeCloseTo(0.35, 6);
    expect(edge.expectedNetReturnPct).toBeCloseTo(0.07, 6);
    expect(edge.rewardToRiskRatio).toBeGreaterThan(2);
    expect(edge.liveTrading).toBe(false);
  });

  it("blocks risking 5 EUR for only about 15 cents net", () => {
    const item = strategy(0.04, 0.01, 0.02);
    const edge = evaluatePaperMinimumNetEdge(item, 5);
    const decision = evaluateTreasuryEntry(item, state(item), 5);

    expect(edge.expectedNetProfitEur).toBeCloseTo(0.15, 6);
    expect(edge.expectedNetReturnPct).toBeCloseTo(0.03, 6);
    expect(edge.allowed).toBe(false);
    expect(decision.allowed).toBe(false);
    expect(decision.maximumBudgetEur).toBe(0);
    expect(decision.reasons.join(" ")).toContain("oportunidad demasiado pequeña");
  });

  it("blocks a nominally large target when downside asymmetry is poor", () => {
    const item = strategy(0.08, 0.01, 0.06);
    const edge = evaluatePaperMinimumNetEdge(item, 10);

    expect(edge.expectedNetProfitEur).toBeCloseTo(0.7, 6);
    expect(edge.rewardToRiskRatio).toBe(1);
    expect(edge.allowed).toBe(false);
  });

  it("still blocks entries whose expected result is only a few thousandths", () => {
    const item = strategy(0.011, 0.01, 0.02);
    const edge = evaluatePaperMinimumNetEdge(item, 5);

    expect(edge.expectedNetProfitEur).toBeCloseTo(0.005, 6);
    expect(edge.allowed).toBe(false);
  });
});
