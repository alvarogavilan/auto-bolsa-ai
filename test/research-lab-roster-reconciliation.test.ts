import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";
import { initializeResearchLab } from "../src/research-lab";
import { reconcileResearchLabRoster } from "../src/research-lab-roster-reconciliation";

function candidate(lane: ResearchLaneId, index: number): MarketCandidate {
  return {
    pairKey: `${lane}-${index}`,
    symbol: `${lane}-${index}/EUR`,
    base: `${lane}-${index}`,
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
    score: 90 - index,
  };
}

function universe(counts = { fast: 5, intraday: 8, swing: 12 }): MarketUniverse {
  const lane = (id: ResearchLaneId, count: number) => Array.from({ length: count }, (_, index) => candidate(id, index));
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 2_000,
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
    eurMarketsDiscovered: 25,
    onlineEurMarkets: 25,
    capitalCompatibleMarkets: 25,
    topByLane: {
      fast: lane("fast", counts.fast),
      intraday: lane("intraday", counts.intraday),
      swing: lane("swing", counts.swing),
    },
    candidates: [],
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

describe("persisted PAPER roster reconciliation", () => {
  it("adds missing strategies without resetting existing evidence", () => {
    const oldUniverse = universe({ fast: 3, intraday: 3, swing: 3 });
    const persisted = initializeResearchLab(oldUniverse, 1_000);
    persisted.strategies[0]!.cashEur = 47.5;
    persisted.strategies[0]!.performance.closedTrades = 4;
    persisted.strategies[0]!.lastDecision = "Evidencia existente";

    const result = reconcileResearchLabRoster(persisted, universe(), 3_000);

    expect(result.state.strategies).toHaveLength(25);
    expect(result.addedStrategyCount).toBe(16);
    expect(result.state.strategies[0]!.cashEur).toBe(47.5);
    expect(result.state.strategies[0]!.performance.closedTrades).toBe(4);
    expect(result.state.strategies[0]!.lastDecision).toBe("Evidencia existente");
    expect(result.state.initializedAt).toBe(1_000);
    expect(result.state.liveTrading).toBe(false);
  });

  it("is idempotent and never duplicates an already reconciled roster", () => {
    const current = initializeResearchLab(universe(), 1_000);
    const result = reconcileResearchLabRoster(current, universe(), 3_000);

    expect(result.addedStrategyCount).toBe(0);
    expect(new Set(result.state.strategies.map((strategy) => strategy.id)).size).toBe(25);
    expect(result.liveTrading).toBe(false);
  });
});
