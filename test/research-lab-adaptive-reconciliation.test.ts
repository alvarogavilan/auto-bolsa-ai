import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";
import { initializeResearchLab as initializeBaseResearchLab } from "../src/research-lab";
import { reconcileResearchLab } from "../src/research-lab-adaptive";

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

function universe(counts: Record<ResearchLaneId, number>): MarketUniverse {
  const lane = (id: ResearchLaneId) => Array.from({ length: counts[id] }, (_, index) => candidate(id, index));
  const candidates = [...lane("fast"), ...lane("intraday"), ...lane("swing")];
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 2_000,
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
    eurMarketsDiscovered: candidates.length,
    onlineEurMarkets: candidates.length,
    capitalCompatibleMarkets: candidates.length,
    topByLane: { fast: lane("fast"), intraday: lane("intraday"), swing: lane("swing") },
    candidates,
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

describe("adaptive runtime roster reconciliation", () => {
  it("expands and migrates a persisted 3/3/3 cohort without resetting evidence", () => {
    const persisted = initializeBaseResearchLab(universe({ fast: 3, intraday: 3, swing: 3 }), 1_000);
    persisted.strategies[0]!.initialCashEur = 50;
    persisted.strategies[0]!.cashEur = 47.25;
    persisted.strategies[0]!.equityEur = 47.25;
    persisted.strategies[0]!.peakEquityEur = 50;
    persisted.strategies[0]!.performance.closedTrades = 3;
    persisted.strategies[0]!.lastDecision = "evidencia preservada";

    const reconciled = reconcileResearchLab(persisted, universe({ fast: 5, intraday: 8, swing: 12 }), 3_000);

    expect(reconciled.strategies).toHaveLength(25);
    expect(reconciled.strategies.filter((strategy) => strategy.lane === "fast")).toHaveLength(5);
    expect(reconciled.strategies.filter((strategy) => strategy.lane === "intraday")).toHaveLength(8);
    expect(reconciled.strategies.filter((strategy) => strategy.lane === "swing")).toHaveLength(12);
    expect(reconciled.strategies[0]!.initialCashEur).toBe(100);
    expect(reconciled.strategies[0]!.cashEur).toBe(97.25);
    expect(reconciled.strategies[0]!.equityEur).toBe(97.25);
    expect(reconciled.strategies[0]!.performance.closedTrades).toBe(3);
    expect(reconciled.strategies[0]!.lastDecision).toBe("evidencia preservada");
    expect(reconciled.initializedAt).toBe(1_000);
    expect(reconciled.liveTrading).toBe(false);
  });
});
