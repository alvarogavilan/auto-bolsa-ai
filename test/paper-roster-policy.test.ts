import { describe, expect, it } from "vitest";
import { buildPaperRosterPlan, PAPER_ROSTER_LIMITS } from "../src/paper-roster-policy";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";

function candidate(pairKey: string): MarketCandidate {
  return {
    pairKey,
    symbol: pairKey,
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

describe("expanded PAPER roster policy", () => {
  it("expands observation from nine to at most twenty-five lane strategies", () => {
    const plan = buildPaperRosterPlan(universe());

    expect(PAPER_ROSTER_LIMITS).toEqual({ fast: 5, intraday: 8, swing: 12 });
    expect(plan.selectedByLane.fast).toHaveLength(5);
    expect(plan.selectedByLane.intraday).toHaveLength(8);
    expect(plan.selectedByLane.swing).toHaveLength(12);
    expect(plan.selectedStrategies).toBe(25);
  });

  it("does not invent markets when a lane has fewer eligible candidates", () => {
    const small = universe();
    small.topByLane.fast = small.topByLane.fast.slice(0, 2);
    const plan = buildPaperRosterPlan(small);

    expect(plan.selectedByLane.fast).toHaveLength(2);
    expect(plan.selectedStrategies).toBe(22);
    expect(plan.liveTrading).toBe(false);
  });
});
