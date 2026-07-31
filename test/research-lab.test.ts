import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "../src/market-universe";
import {
  applyResearchCandles,
  initializeResearchLab,
  isStrategyDue,
  recordResearchError,
  summarizeResearchLab,
} from "../src/research-lab";
import type { Candle } from "../src/types";

function candidate(lane: ResearchLaneId, index: number): MarketCandidate {
  return {
    pairKey: `${lane.toUpperCase()}${index}ZEUR`,
    symbol: `${lane.toUpperCase()}${index}/EUR`,
    base: `${lane.toUpperCase()}${index}`,
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
    score: 90 - index,
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
    eurMarketsDiscovered: 15,
    onlineEurMarkets: 15,
    capitalCompatibleMarkets: 15,
    topByLane: {
      fast: Array.from({ length: 5 }, (_, index) => candidate("fast", index)),
      intraday: Array.from({ length: 5 }, (_, index) => candidate("intraday", index)),
      swing: Array.from({ length: 5 }, (_, index) => candidate("swing", index)),
    },
    candidates: [],
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

function candles(count = 50): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.2 + Math.sin(index / 3);
    return {
      time: 1_700_000_000 + index * 300,
      open: close - 0.1,
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: 1_000 + index,
    };
  });
}

describe("multi-horizon PAPER lab", () => {
  it("locks a maximum of three independent strategies per lane for fourteen days", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);

    expect(state.strategies).toHaveLength(9);
    expect(state.cohortLockedUntil - state.initializedAt).toBe(14 * 24 * 60 * 60_000);
    expect(state.strategies.every((strategy) => strategy.initialCashEur === 50)).toBe(true);
    expect(state.strategies.filter((strategy) => strategy.lane === "fast")).toHaveLength(3);
    expect(state.strategies.filter((strategy) => strategy.lane === "intraday")).toHaveLength(3);
    expect(state.strategies.filter((strategy) => strategy.lane === "swing")).toHaveLength(3);
    expect(state.liveTrading).toBe(false);
  });

  it("respects each lane clock and never evaluates the same closed candle twice", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const fast = state.strategies.find((strategy) => strategy.lane === "fast")!;

    expect(isStrategyDue(fast, now)).toBe(true);
    applyResearchCandles(fast, candles(), now);
    expect(fast.uniqueCandles).toBe(1);
    expect(isStrategyDue(fast, now + 4 * 60_000)).toBe(false);
    expect(isStrategyDue(fast, now + 5 * 60_000)).toBe(true);

    applyResearchCandles(fast, candles(), now + 5 * 60_000);
    expect(fast.uniqueCandles).toBe(1);
    expect(fast.duplicateSkips).toBe(1);
  });

  it("isolates repeated market-data failures and halts only the affected strategy", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const strategy = state.strategies[0]!;

    recordResearchError(strategy, new Error("Kraken OHLC timeout"), now);
    recordResearchError(strategy, new Error("Kraken OHLC timeout"), now + 300_000);
    recordResearchError(strategy, new Error("Kraken OHLC timeout"), now + 600_000);

    expect(strategy.status).toBe("error");
    expect(strategy.consecutiveErrors).toBe(3);
    expect(state.strategies.slice(1).every((item) => item.status === "active")).toBe(true);
  });

  it("reports comparable virtual balances but permanently blocks automatic live eligibility", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const summary = summarizeResearchLab(state, now) as {
      independentVirtualCapitalPerStrategyEur: number;
      strategiesAreComparableNotAdditive: boolean;
      eligibleForLiveReview: boolean;
      liveTrading: boolean;
      provisionalLeaderboard: unknown[];
    };

    expect(summary.independentVirtualCapitalPerStrategyEur).toBe(50);
    expect(summary.strategiesAreComparableNotAdditive).toBe(true);
    expect(summary.provisionalLeaderboard).toHaveLength(9);
    expect(summary.eligibleForLiveReview).toBe(false);
    expect(summary.liveTrading).toBe(false);
  });
});
