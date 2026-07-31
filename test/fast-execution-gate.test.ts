import { describe, expect, it } from "vitest";
import type { MarketCandidate, MarketUniverse } from "../src/market-universe";
import {
  applyResearchCandles,
  initializeResearchLab,
  type FastEntryGate,
} from "../src/research-lab";
import type { Candle } from "../src/types";

const BUY_SIGNAL_CLOSES = [
  100,
  99.61396776074064,
  98.6285416314374,
  98.65807909262034,
  99.21748094080644,
  99.22527749479934,
  98.97706749409033,
  98.32364684134882,
  97.57659448625111,
  97.85362825987056,
  98.74363142903736,
  99.689747280863,
  98.72519368862602,
  97.86997608464418,
  98.00551047869769,
  98.2895885830802,
  98.2216780237793,
  98.9812143357764,
  99.9383842138043,
  99.75454049809389,
  99.50262238022287,
  100.31877221431512,
  100.14173067468094,
  99.59273447691274,
  100.07314368817809,
  99.95350650893783,
  99.39904224379886,
  98.55447018459589,
  97.91809983773122,
  100.50212967526686,
];

function market(index: number): MarketCandidate {
  return {
    pairKey: `FAST${index}ZEUR`,
    symbol: `FAST${index}/EUR`,
    base: `FAST${index}`,
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
    estimatedOrderMinimumEur: 1,
    capitalFit: true,
    maximumPaperAllocationEur: 10,
    takerRoundTripCostPct: 0.011,
    makerRoundTripCostPct: 0.0066,
    fastEligible: true,
    intradayEligible: false,
    swingEligible: false,
    exclusionReasons: [],
    score: 95 - index,
  };
}

function universe(): MarketUniverse {
  const fast = [market(0), market(1), market(2)];
  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: 1_800_000_000_000,
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
    topByLane: { fast, intraday: [], swing: [] },
    candidates: fast,
    excludedReasonCounts: {},
    opportunityMap: [],
    liveTrading: false,
  };
}

function candles(closes = BUY_SIGNAL_CLOSES): Candle[] {
  const all = [...closes, closes.at(-1)! + 0.05];
  return all.map((close, index) => ({
    time: 1_700_000_000 + index * 300,
    open: close - 0.1,
    high: close + 0.3,
    low: close - 0.3,
    close,
    volume: 1_000 + index,
  }));
}

function gate(now: number, allowed: boolean, blocker: string | null = null): FastEntryGate {
  return {
    checkedAt: now,
    allowed,
    costPct: allowed ? 0.009 : 0.021,
    blocker,
  };
}

describe("fast PAPER execution gate", () => {
  it("blocks new fast entries unless recent public execution evidence is eligible", () => {
    const now = 1_800_000_000_000;
    const state = initializeResearchLab(universe(), now);
    const [blocked, allowed, stale] = state.strategies;

    applyResearchCandles(
      blocked!,
      candles(),
      now,
      gate(now, false, "immediate-round-trip-cost-too-high"),
    );
    expect(blocked!.position).toBeNull();
    expect(blocked!.performance.buys).toBe(0);
    expect(blocked!.lastDecision).toContain("Compra rápida vetada por ejecución");

    applyResearchCandles(allowed!, candles(), now, gate(now, true));
    expect(allowed!.position).not.toBeNull();
    expect(allowed!.performance.buys).toBe(1);

    applyResearchCandles(stale!, candles(), now, gate(now - 11 * 60_000, true));
    expect(stale!.position).toBeNull();
    expect(stale!.lastDecision).toContain("evidencia de ejecución caducada");
  });

  it("never blocks a stop-loss exit when the current execution gate is negative", () => {
    const now = 1_800_000_000_000;
    const strategy = initializeResearchLab(universe(), now).strategies[0]!;

    applyResearchCandles(strategy, candles(), now, gate(now, true));
    expect(strategy.position).not.toBeNull();

    const exitCloses = [...BUY_SIGNAL_CLOSES, 90];
    applyResearchCandles(
      strategy,
      candles(exitCloses),
      now + 5 * 60_000,
      gate(now + 5 * 60_000, false, "insufficient-bid-depth-for-round-trip"),
    );

    expect(strategy.position).toBeNull();
    expect(strategy.performance.sells).toBe(1);
    expect(strategy.lastDecision).toContain("Stop loss");
  });
});
