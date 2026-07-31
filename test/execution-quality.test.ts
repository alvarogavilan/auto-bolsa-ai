import { describe, expect, it } from "vitest";
import {
  analyzeExecutionQuality,
  simulateMarketBuy,
  simulateMarketSell,
} from "../src/execution-quality";
import type { MarketCandidate } from "../src/market-universe";
import type { PreTradeBook, PreTradeLevel } from "../src/kraken-pretrade";

function level(price: number, quantity: number): PreTradeLevel {
  return { price, quantity, orderCount: 1, publishedAt: null };
}

function candidate(overrides: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "BTC",
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
    orderMinimumBase: 0.001,
    costMinimumEur: 0.5,
    estimatedOrderMinimumEur: 0.5,
    capitalFit: true,
    maximumPaperAllocationEur: 10,
    takerRoundTripCostPct: 0.011,
    makerRoundTripCostPct: 0.0066,
    fastEligible: true,
    intradayEligible: true,
    swingEligible: true,
    exclusionReasons: [],
    score: 95,
    ...overrides,
  };
}

function book(overrides: Partial<PreTradeBook> = {}): PreTradeBook {
  return {
    symbol: "BTC/EUR",
    baseAsset: "BTC",
    quoteAsset: "EUR",
    asks: [level(100.1, 0.2), level(100.2, 1)],
    bids: [level(100, 0.2), level(99.9, 1)],
    fetchedAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe("pre-trade execution quality", () => {
  it("walks multiple ask levels to fill a fixed euro notional", () => {
    const fill = simulateMarketBuy([
      level(100, 0.05),
      level(101, 1),
    ], 10);

    expect(fill.covered).toBe(true);
    expect(fill.levelsUsed).toBe(2);
    expect(fill.quoteSpentEur).toBe(10);
    expect(fill.averagePrice).toBeGreaterThan(100);
    expect(fill.slippagePct).toBeGreaterThan(0);
  });

  it("detects insufficient depth instead of pretending a market order filled", () => {
    const buy = simulateMarketBuy([level(100, 0.02)], 10);
    const sell = simulateMarketSell([level(99, 0.01)], 0.05);

    expect(buy.covered).toBe(false);
    expect(buy.quoteSpentEur).toBe(2);
    expect(sell.covered).toBe(false);
    expect(sell.baseSold).toBe(0.01);
  });

  it("includes both taker fees, spread and book impact in the immediate round trip", () => {
    const result = analyzeExecutionQuality(candidate(), book(), 10, 0.004);

    expect(result.buy.covered).toBe(true);
    expect(result.sell?.covered).toBe(true);
    expect(result.buyFeeEur).toBeCloseTo(0.04, 8);
    expect(result.sellFeeEur).toBeGreaterThan(0.039);
    expect(result.immediateRoundTripLossEur).toBeGreaterThan(0.08);
    expect(result.immediateRoundTripCostPct).toBeGreaterThan(0.008);
    expect(result.fastExecutionEligible).toBe(true);
    expect(result.liveTrading).toBe(false);
  });

  it("blocks fast execution when the market book cannot cover ten euros", () => {
    const result = analyzeExecutionQuality(
      candidate(),
      book({ asks: [level(100, 0.01)] }),
      10,
      0.004,
    );

    expect(result.orderBookCoveragePassed).toBe(false);
    expect(result.fastExecutionEligible).toBe(false);
    expect(result.blocker).toBe("insufficient-ask-depth-for-ten-eur");
  });

  it("blocks liquid books when the daily range is too small relative to costs", () => {
    const result = analyzeExecutionQuality(
      candidate({ range24hPct: 0.01 }),
      book(),
      10,
      0.004,
    );

    expect(result.orderBookCoveragePassed).toBe(true);
    expect(result.costHurdlePassed).toBe(false);
    expect(result.fastExecutionEligible).toBe(false);
    expect(result.blocker).toBe("daily-range-does-not-cover-cost-hurdle");
  });
});
