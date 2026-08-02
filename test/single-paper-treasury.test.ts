import { describe, expect, it } from "vitest";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";
import {
  buildPaperTreasurySnapshot,
  evaluateTreasuryEntry,
  PAPER_OPERATIONAL_BANKROLL_EUR,
} from "../src/treasury-risk";

function strategy(id: string, lane: "fast" | "intraday" | "swing", costEur = 0, pnlEur = 0): LabStrategyState {
  const position = costEur > 0
    ? {
        quantity: costEur,
        entryPrice: 1,
        entryTime: 1_000,
        costEur,
        stopLoss: 0.98,
        takeProfit: 1.08,
      }
    : null;
  return {
    id,
    lane,
    pairKey: id,
    symbol: `${id}/EUR`,
    base: id,
    status: "active",
    initialCashEur: 100,
    cashEur: 100 - costEur,
    equityEur: 100,
    peakEquityEur: 100,
    maxDrawdownPct: 0,
    position,
    config: {
      id: lane,
      intervalMinutes: 5,
      fastPeriod: 5,
      slowPeriod: 13,
      rsiPeriod: 7,
      buyRsiMinimum: 46,
      buyRsiMaximum: 62,
      sellRsi: 68,
      stopLossPct: 0.02,
      takeProfitPct: 0.08,
      cooldownMinutes: 20,
      maximumHoldingMinutes: 180,
      feePctEachSide: 0.004,
      slippagePctEachSide: 0.001,
    },
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.01,
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
    performance: {
      buys: 0,
      sells: pnlEur === 0 ? 0 : 1,
      closedTrades: pnlEur === 0 ? 0 : 1,
      winningTrades: pnlEur > 0 ? 1 : 0,
      losingTrades: pnlEur < 0 ? 1 : 0,
      grossProfitEur: Math.max(0, pnlEur),
      grossLossEur: Math.max(0, -pnlEur),
      netPnlEur: pnlEur,
      totalFeesEur: 0,
    },
    trades: pnlEur === 0 ? [] : [{
      id: `${id}-sell`,
      side: "sell",
      timestamp: 2_000,
      price: 1,
      quantity: 1,
      grossEur: 1,
      feeEur: 0,
      reason: "test",
      pnlEur,
    }],
  };
}

function state(strategies: LabStrategyState[]): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: 1_000,
    cohortLockedUntil: 2_000,
    sourceUniverseGeneratedAt: 1_000,
    lastCycleAt: 1_000,
    cycles: 1,
    strategies,
    liveTrading: false,
  };
}

describe("single PAPER treasury", () => {
  it("treats strategy balances as comparative and caps one operational bankroll", () => {
    const snapshot = buildPaperTreasurySnapshot(state([
      strategy("a", "fast", 5),
      strategy("b", "intraday", 7.5),
      strategy("c", "swing", 10),
    ]));

    expect(snapshot.initialBankrollEur).toBe(PAPER_OPERATIONAL_BANKROLL_EUR);
    expect(snapshot.committedCapitalEur).toBe(22.5);
    expect(snapshot.maximumAggregateExposureEur).toBe(35);
    expect(snapshot.allocatableCashEur).toBe(12.5);
    expect(snapshot.benchmarkStrategiesAreComparableNotAdditive).toBe(true);
    expect(snapshot.liveTrading).toBe(false);
  });

  it("allows useful lane budgets but blocks over-allocation and micro positions", () => {
    const fast = strategy("candidate", "fast");
    const healthy = state([fast, strategy("open", "swing", 10)]);
    const allowed = evaluateTreasuryEntry(fast, healthy, 5);
    expect(allowed.allowed).toBe(true);
    expect(allowed.maximumBudgetEur).toBe(5);

    const micro = evaluateTreasuryEntry(fast, healthy, 1);
    expect(micro.allowed).toBe(false);
    expect(micro.maximumBudgetEur).toBe(0);

    const saturated = state([
      fast,
      strategy("one", "swing", 10),
      strategy("two", "swing", 10),
      strategy("three", "swing", 10),
      strategy("four", "fast", 5),
    ]);
    const blocked = evaluateTreasuryEntry(fast, saturated, 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.snapshot.allocatableCashEur).toBe(0);
  });

  it("carries realized PAPER PnL into the single operational equity", () => {
    const snapshot = buildPaperTreasurySnapshot(state([
      strategy("winner", "fast", 0, 2.5),
      strategy("loser", "intraday", 0, -1),
    ]));
    expect(snapshot.realizedPnlEur).toBe(1.5);
    expect(snapshot.equityEur).toBe(101.5);
  });
});
