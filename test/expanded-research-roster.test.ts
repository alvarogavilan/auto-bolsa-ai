import { describe, expect, it } from "vitest";
import { selectExpandedResearchRoster, summarizeExpandedResearchRoster } from "../src/expanded-research-roster";
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

describe("expanded research roster", () => {
  it("selects five fast, eight intraday and twelve swing candidates", () => {
    const selected = selectExpandedResearchRoster(universe());
    expect(selected).toHaveLength(25);
    expect(selected.filter((item) => item.lane === "fast")).toHaveLength(5);
    expect(selected.filter((item) => item.lane === "intraday")).toHaveLength(8);
    expect(selected.filter((item) => item.lane === "swing")).toHaveLength(12);
  });

  it("keeps safety and sizing unchanged", () => {
    const summary = summarizeExpandedResearchRoster(universe());
    expect(summary).toMatchObject({
      strategyCount: 25,
      maximumStrategies: 25,
      thresholdsUnchanged: true,
      sizingUnchanged: true,
      liveTrading: false,
    });
  });
});
