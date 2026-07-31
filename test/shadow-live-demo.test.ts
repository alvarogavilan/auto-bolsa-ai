import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";
import {
  initializeResearchLab,
  type FastEntryGate,
} from "../src/research-lab";
import { buildShadowLiveDemo } from "../src/shadow-live-demo";
import { initializeBuyHoldBenchmark } from "../src/strategy-benchmark";

function candidate(lane: ResearchLaneId): MarketCandidate {
  return {
    pairKey: `${lane.toUpperCase()}ZEUR`,
    symbol: `${lane.toUpperCase()}/EUR`,
    base: lane.toUpperCase(),
    quote: "EUR",
    status: "online",
    ask: 100.1,
    bid: 100,
    last: 100.05,
    spreadPct: 0.001,
    range24hPct: 0.08,
    volume24hBase: 1_000_000,
    volume24hEur: 100_000_000,
    trades24h: 50_000,
    orderMinimumBase: 0.01,
    costMinimumEur: 0.5,
    estimatedOrderMinimumEur: 1.001,
    capitalFit: true,
    maximumPaperAllocationEur: 10,
    takerRoundTripCostPct: 0.011,
    makerRoundTripCostPct: 0.0066,
    fastEligible: lane === "fast",
    intradayEligible: lane === "intraday",
    swingEligible: lane === "swing",
    exclusionReasons: [],
    score: 90,
  };
}

function universe(): MarketUniverse {
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 1_000,
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
    eurMarketsDiscovered: 3,
    onlineEurMarkets: 3,
    capitalCompatibleMarkets: 3,
    topByLane: {
      fast: [candidate("fast")],
      intraday: [candidate("intraday")],
      swing: [candidate("swing")],
    },
    candidates: [],
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

describe("shadow-live demo", () => {
  it("blocks a new fast DEMO entry when public execution evidence is unavailable", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    state.strategies = [state.strategies.find((strategy) => strategy.lane === "fast")!];

    const demo = buildShadowLiveDemo(state, {}, {}, now);

    expect(demo.status).toBe("observing_blocked");
    expect("executionGate" in demo && demo.executionGate.entryAllowed).toBe(false);
    expect(demo.sendsOrdersToKraken).toBe(false);
    expect(demo.realBalanceTouched).toBe(false);
    expect(demo.liveTrading).toBe(false);
  });

  it("observes the real market when the fast execution gate is recent and favorable", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const strategy = state.strategies.find((item) => item.lane === "fast")!;
    state.strategies = [strategy];
    const gate: FastEntryGate = {
      checkedAt: now - 60_000,
      allowed: true,
      costPct: 0.009,
      blocker: null,
    };

    const demo = buildShadowLiveDemo(state, { [strategy.pairKey]: gate }, {}, now);

    expect(demo.status).toBe("observing_market");
    expect("executionGate" in demo && demo.executionGate.fresh).toBe(true);
    expect("selectedStrategy" in demo && demo.selectedStrategy.symbol).toBe(strategy.symbol);
    expect("automation" in demo && demo.automation.requiresIphoneOpen).toBe(false);
  });

  it("keeps a simulated position visible even if a later entry gate is blocked", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const strategy = state.strategies.find((item) => item.lane === "fast")!;
    state.strategies = [strategy];
    strategy.cashEur = 39.96;
    strategy.position = {
      quantity: 0.099,
      entryPrice: 101,
      entryTime: now - 30 * 60_000,
      costEur: 10.04,
      stopLoss: 99,
      takeProfit: 104,
    };

    const demo = buildShadowLiveDemo(state, {}, {}, now);

    expect(demo.status).toBe("simulated_position_open");
    expect("selectedStrategy" in demo && demo.selectedStrategy.positionOpen).toBe(true);
    expect(demo.message).toContain("Posición DEMO abierta");
  });

  it("reports alpha against buy and hold without enabling real trading", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const strategy = state.strategies.find((item) => item.lane === "intraday")!;
    state.strategies = [strategy];
    strategy.equityEur = 51;
    const benchmark = initializeBuyHoldBenchmark(strategy, 100, now);
    benchmark.netReturnPct = 0.25;

    const demo = buildShadowLiveDemo(state, {}, { [strategy.id]: benchmark }, now);

    expect("benchmark" in demo && demo.benchmark.alphaPct).toBe(1.75);
    expect("benchmark" in demo && demo.benchmark.outperformedBuyAndHold).toBe(true);
    expect(demo.eligibleForLiveReview).toBe(false);
    expect(demo.liveTrading).toBe(false);
  });
});
