import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse } from "../src/market-universe";
import { initializeResearchLab } from "../src/research-lab";
import {
  buildBenchmarkComparison,
  initializeBuyHoldBenchmark,
  updateBuyHoldBenchmark,
} from "../src/strategy-benchmark";

function market(): MarketCandidate {
  return {
    pairKey: "XBTEUR",
    symbol: "BTC/EUR",
    base: "XBT",
    quote: "EUR",
    status: "online",
    ask: 100.1,
    bid: 100,
    last: 100,
    spreadPct: 0.001,
    range24hPct: 0.08,
    volume24hBase: 1_000_000,
    volume24hEur: 100_000_000,
    trades24h: 50_000,
    orderMinimumBase: 0.0001,
    costMinimumEur: 0.5,
    estimatedOrderMinimumEur: 1,
    capitalFit: true,
    maximumPaperAllocationEur: 10,
    takerRoundTripCostPct: 0.011,
    makerRoundTripCostPct: 0.0066,
    fastEligible: true,
    intradayEligible: false,
    swingEligible: false,
    exclusionReasons: [],
    score: 99,
  };
}

function universe(): MarketUniverse {
  const candidate = market();
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 1_800_000_000_000,
    capitalEur: 100,
    maximumPaperAllocationEur: 10,
    feeModel: {
      version: "kraken-spot-tier0-2026-07",
      makerFeePctEachSide: 0.0023,
      takerFeePctEachSide: 0.004,
      makerSlippageBufferPctRoundTrip: 0.001,
      takerSlippageBufferPctRoundTrip: 0.002,
    },
    lanes: [],
    eurMarketsDiscovered: 1,
    onlineEurMarkets: 1,
    capitalCompatibleMarkets: 1,
    topByLane: { fast: [candidate], intraday: [], swing: [] },
    candidates: [candidate],
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

describe("PAPER buy-and-hold benchmark", () => {
  it("uses the same ten-euro exposure and includes entry and liquidation costs", () => {
    const strategy = initializeResearchLab(universe(), 1_800_000_000_000).strategies[0]!;
    const benchmark = initializeBuyHoldBenchmark(strategy, 100, 1_800_000_000_000);

    expect(benchmark.allocatedEur).toBe(10);
    expect(benchmark.buyFeeEur).toBe(0.04);
    expect(benchmark.retainedCashEur).toBe(89.96);
    expect(benchmark.equityEur).toBeLessThan(100);
    expect(benchmark.netReturnPct).toBeLessThan(0);
    expect(benchmark.liveTrading).toBe(false);
  });

  it("updates without resetting its entry and reports alpha against the strategy", () => {
    const strategy = initializeResearchLab(universe(), 1_800_000_000_000).strategies[0]!;
    const initial = initializeBuyHoldBenchmark(strategy, 100, 1_800_000_000_000);
    const updated = updateBuyHoldBenchmark(initial, strategy, 110, 1_800_000_300_000);

    expect(updated.entryRawPrice).toBe(100);
    expect(updated.observations).toBe(2);
    expect(updated.netReturnPct).toBeGreaterThan(0);

    strategy.equityEur = updated.equityEur + 0.5;
    const comparison = buildBenchmarkComparison(
      [strategy],
      { [strategy.id]: updated },
    ) as {
      measuredStrategies: number;
      outperformingStrategies: number;
      alphaLeaderboard: Array<{ alphaPct: number; outperformedBenchmark: boolean }>;
      liveTrading: boolean;
    };

    expect(comparison.measuredStrategies).toBe(1);
    expect(comparison.outperformingStrategies).toBe(1);
    expect(comparison.alphaLeaderboard[0]!.alphaPct).toBeGreaterThan(0);
    expect(comparison.alphaLeaderboard[0]!.outperformedBenchmark).toBe(true);
    expect(comparison.liveTrading).toBe(false);
  });
});
