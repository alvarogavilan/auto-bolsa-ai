import { describe, expect, it } from "vitest";
import { initializeResearchLab } from "../src/research-lab";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";

function candidate(pairKey: string): MarketCandidate {
  return {
    pairKey,
    symbol: `${pairKey}/EUR`,
    base: pairKey,
    quote: "EUR",
    status: "online",
    ask: 1,
    bid: 1,
    last: 1,
    spreadPct: 0,
    range24hPct: 0.05,
    volume24hBase: 1_000_000,
    volume24hEur: 1_000_000,
    trades24h: 10_000,
    orderMinimumBase: 0.01,
    costMinimumEur: 1,
    estimatedOrderMinimumEur: 1,
    capitalFit: true,
    maximumPaperAllocationEur: 10,
    takerRoundTripCostPct: 0.01,
    makerRoundTripCostPct: 0.006,
    fastEligible: true,
    intradayEligible: true,
    swingEligible: true,
    exclusionReasons: [],
    score: 90,
  };
}

function lane(count: number, prefix: ResearchLaneId): MarketCandidate[] {
  return Array.from({ length: count }, (_, index) => candidate(`${prefix}-${index}`));
}

function universe(): MarketUniverse {
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 1,
    capitalEur: 50,
    maximumPaperAllocationEur: 10,
    feeModel: {
      version: "kraken-spot-tier0-2026-07",
      makerFeePctEachSide: 0.0023,
      takerFeePctEachSide: 0.004,
      makerSlippageBufferPctRoundTrip: 0.001,
      takerSlippageBufferPctRoundTrip: 0.002,
    },
    lanes: [],
    eurMarketsDiscovered: 40,
    onlineEurMarkets: 40,
    capitalCompatibleMarkets: 40,
    topByLane: {
      fast: lane(10, "fast"),
      intraday: lane(12, "intraday"),
      swing: lane(20, "swing"),
    },
    candidates: [],
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

describe("expanded PAPER roster initialization", () => {
  it("creates the configured 5/8/12 strategy roster", () => {
    const state = initializeResearchLab(universe(), 1_000);

    expect(state.strategies).toHaveLength(25);
    expect(state.strategies.filter((strategy) => strategy.lane === "fast")).toHaveLength(5);
    expect(state.strategies.filter((strategy) => strategy.lane === "intraday")).toHaveLength(8);
    expect(state.strategies.filter((strategy) => strategy.lane === "swing")).toHaveLength(12);
    expect(state.liveTrading).toBe(false);
  });

  it("uses only available eligible candidates without duplicating markets", () => {
    const small = universe();
    small.topByLane.fast = small.topByLane.fast.slice(0, 2);
    small.topByLane.intraday = small.topByLane.intraday.slice(0, 3);
    small.topByLane.swing = small.topByLane.swing.slice(0, 4);

    const state = initializeResearchLab(small, 1_000);

    expect(state.strategies).toHaveLength(9);
    expect(new Set(state.strategies.map((strategy) => strategy.id)).size).toBe(9);
    expect(state.strategies.every((strategy) => strategy.status === "active")).toBe(true);
  });
});
