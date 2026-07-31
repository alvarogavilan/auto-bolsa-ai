import { describe, expect, it } from "vitest";
import {
  buildMarketUniverse,
  evaluateMarketCandidate,
} from "../src/market-universe";
import type { KrakenAssetPair, KrakenTicker } from "../src/kraken-markets";

function pair(overrides: Partial<KrakenAssetPair> = {}): KrakenAssetPair {
  return {
    key: "XXBTZEUR",
    altname: "XBTEUR",
    wsname: "XBT/EUR",
    base: "XXBT",
    quote: "ZEUR",
    ordermin: 0.0001,
    costmin: 0.45,
    pairDecimals: 1,
    lotDecimals: 8,
    tickSize: 0.1,
    status: "online",
    ...overrides,
  };
}

function ticker(overrides: Partial<KrakenTicker> = {}): KrakenTicker {
  return {
    ask: 100_010,
    bid: 100_000,
    last: 100_005,
    volume24h: 1_000,
    vwap24h: 99_000,
    trades24h: 30_000,
    low24h: 96_000,
    high24h: 103_000,
    open24h: 98_000,
    ...overrides,
  };
}

describe("Kraken EUR market universe", () => {
  it("calculates the real round-trip hurdle before calling a market fast-eligible", () => {
    const candidate = evaluateMarketCandidate(pair(), ticker(), 50);

    expect(candidate.base).toBe("BTC");
    expect(candidate.maximumPaperAllocationEur).toBe(10);
    expect(candidate.estimatedOrderMinimumEur).toBeGreaterThanOrEqual(10);
    expect(candidate.takerRoundTripCostPct).toBeGreaterThan(0.009);
    expect(candidate.fastEligible).toBe(true);
    expect(candidate.capitalFit).toBe(true);
  });

  it("rejects markets whose minimum order does not fit the ten-euro allocation", () => {
    const candidate = evaluateMarketCandidate(
      pair({ key: "BIGZEUR", altname: "BIGEUR", wsname: "BIG/EUR", base: "BIG", ordermin: 10 }),
      ticker({ ask: 5, bid: 4.99, last: 5, vwap24h: 5, volume24h: 1_000_000 }),
      50,
    );

    expect(candidate.estimatedOrderMinimumEur).toBe(50);
    expect(candidate.capitalFit).toBe(false);
    expect(candidate.fastEligible).toBe(false);
    expect(candidate.exclusionReasons).toContain("minimum-order-exceeds-allocation");
  });

  it("ranks fast, intraday and swing lanes independently and excludes leverage routes", () => {
    const pairs = [
      pair(),
      pair({ key: "XETHZEUR", altname: "ETHEUR", wsname: "ETH/EUR", base: "XETH", ordermin: 0.002 }),
      pair({ key: "ILLIQZEUR", altname: "ILLIQEUR", wsname: "ILLIQ/EUR", base: "ILLIQ", ordermin: 1 }),
      pair({ key: "XXBTZUSD", altname: "XBTUSD", wsname: "XBT/USD", quote: "ZUSD" }),
    ];
    const tickers = {
      XXBTZEUR: ticker(),
      XETHZEUR: ticker({ ask: 3_001, bid: 3_000, last: 3_000, volume24h: 20_000, vwap24h: 2_950, high24h: 3_150, low24h: 2_850, open24h: 2_900 }),
      ILLIQZEUR: ticker({ ask: 1.05, bid: 0.95, last: 1, volume24h: 1_000, vwap24h: 1, trades24h: 50, high24h: 1.1, low24h: 0.9, open24h: 1 }),
      XXBTZUSD: ticker(),
    };

    const universe = buildMarketUniverse(pairs, tickers, 50);

    expect(universe.eurMarketsDiscovered).toBe(3);
    expect(universe.topByLane.fast.length).toBeGreaterThan(0);
    expect(universe.topByLane.intraday.length).toBeGreaterThan(0);
    expect(universe.topByLane.swing.length).toBeGreaterThan(0);
    expect(universe.opportunityMap.find((route) => route.route === "margin-and-futures")?.status).toBe("excluded");
    expect(universe.liveTrading).toBe(false);
  });
});
