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
  it("uses every available strategy up to the configured lane limits for fourteen days", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);

    expect(state.strategies).toHaveLength(15);
    expect(state.cohortLockedUntil - state.initializedAt).toBe(14 * 24 * 60 * 60_000);
    expect(state.strategies.every((strategy) => strategy.initialCashEur === 50)).toBe(true);
    expect(state.strategies.filter((strategy) => strategy.lane === "fast")).toHaveLength(5);
    expect(state.strategies.filter((strategy) => strategy.lane === "intraday")).toHaveLength(5);
    expect(state.strategies.filter((strategy) => strategy.lane === "swing")).toHaveLength(5);
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
    expect(summary.provisionalLeaderboard).toHaveLength(15);
    expect(summary.eligibleForLiveReview).toBe(false);
    expect(summary.liveTrading).toBe(false);
  });

  it("never persists the same operation twice when the same closed candle is applied again", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const strategy = state.strategies.find((item) => item.lane === "fast")!;
    const gate = { checkedAt: now, allowed: true, costPct: 0.009, blocker: null };
    const buySignalCloses = [
      100, 99.61396776074064, 98.6285416314374, 98.65807909262034, 99.21748094080644,
      99.22527749479934, 98.97706749409033, 98.32364684134882, 97.57659448625111,
      97.85362825987056, 98.74363142903736, 99.689747280863, 98.72519368862602,
      97.86997608464418, 98.00551047869769, 98.2895885830802, 98.2216780237793,
      98.9812143357764, 99.9383842138043, 99.75454049809389, 99.50262238022287,
      100.31877221431512, 100.14173067468094, 99.59273447691274, 100.07314368817809,
      99.95350650893783, 99.39904224379886, 98.55447018459589, 97.91809983773122,
      100.50212967526686,
    ];
    const buySignalCandles = (): Candle[] => {
      const all = [...buySignalCloses, buySignalCloses.at(-1)! + 0.05];
      return all.map((close, index) => ({
        time: 1_700_000_000 + index * 300,
        open: close - 0.1,
        high: close + 0.3,
        low: close - 0.3,
        close,
        volume: 1_000 + index,
      }));
    };

    applyResearchCandles(strategy, buySignalCandles(), now, gate);
    expect(strategy.performance.buys).toBe(1);
    expect(strategy.trades).toHaveLength(1);
    const firstTradeId = strategy.trades[0]!.id;

    applyResearchCandles(strategy, buySignalCandles(), now, gate);
    expect(strategy.performance.buys).toBe(1);
    expect(strategy.trades).toHaveLength(1);
    expect(strategy.trades[0]!.id).toBe(firstTradeId);
    expect(strategy.duplicateSkips).toBe(1);
  });
});
