import { describe, expect, it } from "vitest";
import { buildBenchmarkSuite } from "../src/benchmark-suite";
import { LAB_LANE_CONFIGS, type LabStrategyState } from "../src/research-lab";
import type { PaperBenchmarkMap } from "../src/strategy-benchmark";

function strategy(id: string, equityEur: number): LabStrategyState {
  return {
    id,
    lane: "intraday",
    pairKey: id.toUpperCase(),
    symbol: `${id.toUpperCase()}/EUR`,
    base: id.toUpperCase(),
    status: "active",
    initialCashEur: 50,
    cashEur: equityEur,
    equityEur,
    peakEquityEur: Math.max(50, equityEur),
    maxDrawdownPct: 0.01,
    position: null,
    config: LAB_LANE_CONFIGS.intraday,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextDueAt: 0,
    lastTradeAt: null,
    lastDecision: "hold",
    cycles: 0,
    uniqueCandles: 0,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: 0,
      sells: 0,
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      grossProfitEur: 0,
      grossLossEur: 0,
      netPnlEur: equityEur - 50,
      totalFeesEur: 0,
    },
    trades: [],
  };
}

function benchmark(strategyId: string, netReturnPct: number): PaperBenchmarkMap[string] {
  return {
    schemaVersion: "paper-buy-hold-benchmark-v1",
    strategyId,
    pairKey: strategyId.toUpperCase(),
    symbol: `${strategyId.toUpperCase()}/EUR`,
    lane: "intraday",
    initializedAt: 1,
    lastUpdatedAt: 2,
    initialCashEur: 50,
    allocatedEur: 10,
    retainedCashEur: 39.96,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
    entryRawPrice: 100,
    entryExecutionPrice: 100.1,
    quantity: 0.0999,
    buyFeeEur: 0.04,
    currentRawPrice: 101,
    liquidationExecutionPrice: 100.899,
    grossLiquidationEur: 10.0798,
    sellFeeEur: 0.0403,
    equityEur: 50 + (netReturnPct / 100) * 50,
    peakEquityEur: 51,
    maxDrawdownPct: 0.01,
    netReturnPct,
    observations: 40,
    liveTrading: false,
  };
}

describe("demanding benchmark suite", () => {
  it("requires the strategy to beat both cash and buy-and-hold", () => {
    const winner = strategy("winner", 51);
    const loser = strategy("loser", 49.5);
    const benchmarks: PaperBenchmarkMap = {
      winner: benchmark("winner", 1),
      loser: benchmark("loser", -2),
    };

    const report = buildBenchmarkSuite([winner, loser], benchmarks);
    const winnerEntry = report.entries.find((entry) => entry.strategyId === "winner")!;
    const loserEntry = report.entries.find((entry) => entry.strategyId === "loser")!;

    expect(winnerEntry.strategyReturnPct).toBe(2);
    expect(winnerEntry.bestPassiveReturnPct).toBe(1);
    expect(winnerEntry.alphaVsBestPassivePct).toBe(1);
    expect(winnerEntry.outperformedBestPassive).toBe(true);

    expect(loserEntry.strategyReturnPct).toBe(-1);
    expect(loserEntry.buyHoldReturnPct).toBe(-2);
    expect(loserEntry.bestPassiveReturnPct).toBe(0);
    expect(loserEntry.outperformedBestPassive).toBe(false);
  });

  it("uses cash as the benchmark when buy-and-hold is negative or unavailable", () => {
    const negativeAsset = strategy("negative", 50.5);
    const unavailable = strategy("unavailable", 50.25);
    const report = buildBenchmarkSuite(
      [negativeAsset, unavailable],
      { negative: benchmark("negative", -3) },
    );

    const negative = report.entries.find((entry) => entry.strategyId === "negative")!;
    const missing = report.entries.find((entry) => entry.strategyId === "unavailable")!;

    expect(negative.bestPassiveReturnPct).toBe(0);
    expect(negative.outperformedBestPassive).toBe(true);
    expect(missing.buyHoldReturnPct).toBeNull();
    expect(missing.bestPassiveReturnPct).toBe(0);
  });

  it("never marks the comparison as live eligible", () => {
    const report = buildBenchmarkSuite([strategy("one", 51)], { one: benchmark("one", 0.5) });

    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
    expect(report.methodology).toContain("conservar efectivo");
    expect(report.methodology).toContain("comprar y mantener");
  });
});
