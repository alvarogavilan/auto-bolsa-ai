import { describe, expect, it } from "vitest";
import {
  buildResearchCommitteeReport,
  buildStrategyCommittee,
} from "../src/decision-committee";
import {
  LAB_LANE_CONFIGS,
  type LabStrategyState,
  type ResearchLabState,
} from "../src/research-lab";
import type { PaperBenchmarkMap } from "../src/strategy-benchmark";

const NOW = 1_800_000_000_000;

function strategy(overrides: Partial<LabStrategyState> = {}): LabStrategyState {
  return {
    id: "intraday:XXBTZEUR",
    lane: "intraday",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 51,
    equityEur: 51,
    peakEquityEur: 51,
    maxDrawdownPct: 0.01,
    position: null,
    config: LAB_LANE_CONFIGS.intraday,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: 1_700_000_000,
    lastAttemptAt: NOW - 30_000,
    lastSuccessfulAt: NOW - 30_000,
    nextDueAt: NOW + 60_000,
    lastTradeAt: NOW - 600_000,
    lastDecision: "Sin señal válida para el carril",
    cycles: 200,
    uniqueCandles: 180,
    duplicateSkips: 20,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: 32,
      sells: 30,
      closedTrades: 30,
      winningTrades: 18,
      losingTrades: 12,
      grossProfitEur: 3,
      grossLossEur: 2,
      netPnlEur: 1,
      totalFeesEur: 0.6,
    },
    trades: [],
    ...overrides,
  };
}

function benchmarks(netReturnPct = 1, observations = 40): PaperBenchmarkMap {
  return {
    "intraday:XXBTZEUR": {
      schemaVersion: "paper-buy-hold-benchmark-v1",
      strategyId: "intraday:XXBTZEUR",
      pairKey: "XXBTZEUR",
      symbol: "XBT/EUR",
      lane: "intraday",
      initializedAt: NOW - 86_400_000,
      lastUpdatedAt: NOW,
      initialCashEur: 50,
      allocatedEur: 10,
      retainedCashEur: 39.96,
      feePctEachSide: 0.004,
      slippagePctEachSide: 0.001,
      entryRawPrice: 50_000,
      entryExecutionPrice: 50_050,
      quantity: 0.0001998,
      buyFeeEur: 0.04,
      currentRawPrice: 50_500,
      liquidationExecutionPrice: 50_449.5,
      grossLiquidationEur: 10.0798,
      sellFeeEur: 0.0403,
      equityEur: 49.9995,
      peakEquityEur: 50.5,
      maxDrawdownPct: 0.01,
      netReturnPct,
      observations,
      liveTrading: false,
    },
  };
}

function state(item: LabStrategyState): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: NOW - 14 * 86_400_000,
    cohortLockedUntil: NOW,
    sourceUniverseGeneratedAt: NOW - 60_000,
    lastCycleAt: NOW,
    cycles: 200,
    strategies: [item],
    liveTrading: false,
  };
}

describe("deterministic shadow committee", () => {
  it("marks a strategy as candidate only when all six members approve", () => {
    const report = buildStrategyCommittee(strategy(), {}, benchmarks(1), NOW);

    expect(report.verdict).toBe("candidate");
    expect(report.approvals).toBe(6);
    expect(report.hardVetoCount).toBe(0);
    expect(report.confidence).toBe("qualified");
    expect(report.changesTradingDecision).toBe(false);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("keeps insufficient evidence in observation instead of inventing confidence", () => {
    const item = strategy({
      performance: {
        buys: 5,
        sells: 4,
        closedTrades: 4,
        winningTrades: 3,
        losingTrades: 1,
        grossProfitEur: 0.3,
        grossLossEur: 0.1,
        netPnlEur: 0.2,
        totalFeesEur: 0.08,
      },
    });
    const report = buildStrategyCommittee(item, {}, benchmarks(1, 5), NOW);

    expect(report.verdict).toBe("observe");
    expect(report.confidence).toBe("insufficient");
    expect(report.votes.find((vote) => vote.id === "evidence")?.vote).toBe("observe");
    expect(report.votes.find((vote) => vote.id === "benchmark")?.vote).toBe("observe");
  });

  it("applies hard vetoes for risk and costs without changing PAPER execution", () => {
    const item = strategy({
      maxDrawdownPct: 0.05,
      estimatedTakerRoundTripCostPct: LAB_LANE_CONFIGS.intraday.takeProfitPct,
    });
    const report = buildStrategyCommittee(item, {}, benchmarks(1), NOW);

    expect(report.verdict).toBe("vetoed");
    expect(report.hardVetoCount).toBe(2);
    expect(report.votes.find((vote) => vote.id === "risk")?.hardVeto).toBe(true);
    expect(report.votes.find((vote) => vote.id === "cost")?.hardVeto).toBe(true);
    expect(report.changesTradingDecision).toBe(false);
  });

  it("requires a fresh execution gate for fast strategies", () => {
    const item = strategy({
      id: "fast:XXBTZEUR",
      lane: "fast",
      config: LAB_LANE_CONFIGS.fast,
    });
    const report = buildStrategyCommittee(item, {}, {}, NOW);

    expect(report.verdict).toBe("vetoed");
    expect(report.votes.find((vote) => vote.id === "execution")?.hardVeto).toBe(true);
  });

  it("does not approve a losing strategy merely because buy-and-hold lost more", () => {
    const item = strategy({ equityEur: 49.5, cashEur: 49.5, peakEquityEur: 50 });
    const report = buildStrategyCommittee(item, {}, benchmarks(-2), NOW);
    const vote = report.votes.find((member) => member.id === "benchmark");

    expect(vote?.vote).toBe("veto");
    expect(vote?.reason).toContain("efectivo");
    expect(report.verdict).toBe("observe");
    expect(report.approvals).toBeLessThan(6);
  });

  it("summarizes the cohort without enabling live trading", () => {
    const item = strategy();
    const report = buildResearchCommitteeReport(state(item), {}, benchmarks(1), NOW);

    expect(report.strategyCount).toBe(1);
    expect(report.candidates).toBe(1);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
  });
});
