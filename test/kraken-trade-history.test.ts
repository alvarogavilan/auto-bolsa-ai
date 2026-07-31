import { describe, expect, it } from "vitest";
import {
  fetchTradeExecutionsForOrders,
  parseKrakenTradeHistoryResult,
  type KrakenTradeHistoryPage,
  type KrakenTradeHistoryPageRequest,
} from "../src/kraken-trade-history";

function rawTrade(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    ordertxid: orderId,
    pair: "XXBTZEUR",
    time: 1_800_000_000.25,
    type: "buy",
    ordertype: "limit",
    price: "50000.0",
    cost: "5.0",
    fee: "0.04",
    vol: "0.0001",
    maker: false,
    ...overrides,
  };
}

describe("Kraken TradesHistory parser", () => {
  it("parses individual fill identity, fees and maker/taker evidence", () => {
    const page = parseKrakenTradeHistoryResult({
      trades: {
        "T-1": rawTrade("ORDER-1"),
        "T-2": rawTrade("ORDER-1", { maker: true, vol: "0.0002", cost: "10" }),
      },
      count: 2,
    });

    expect(page.returnedCount).toBe(2);
    expect(page.totalCount).toBe(2);
    expect(page.trades[0]).toMatchObject({
      tradeId: "T-1",
      exchangeOrderId: "ORDER-1",
      side: "buy",
      volumeBase: 0.0001,
      feeQuote: 0.04,
      maker: false,
    });
  });

  it("rejects malformed rows instead of silently filling defaults", () => {
    expect(() => parseKrakenTradeHistoryResult({ trades: { BAD: { ordertxid: "ORDER-1" } }, count: 1 })).toThrow(/Malformed/);
    expect(() => parseKrakenTradeHistoryResult({ trades: [], count: 0 })).toThrow(/missing/);
  });
});

describe("Kraken TradesHistory pagination", () => {
  it("uses a fresh nonce per page, filters target orders and reports complete coverage", async () => {
    const requests: KrakenTradeHistoryPageRequest[] = [];
    const pages: KrakenTradeHistoryPage[] = [
      {
        trades: [
          parseKrakenTradeHistoryResult({ trades: { "T-1": rawTrade("ORDER-1") }, count: 60 }).trades[0]!,
          parseKrakenTradeHistoryResult({ trades: { OTHER: rawTrade("OTHER") }, count: 60 }).trades[0]!,
        ],
        returnedCount: 50,
        totalCount: 60,
      },
      {
        trades: [parseKrakenTradeHistoryResult({ trades: { "T-2": rawTrade("ORDER-1", { time: 1_800_000_001 }) }, count: 60 }).trades[0]!],
        returnedCount: 10,
        totalCount: 60,
      },
    ];
    let nonce = 100;

    const result = await fetchTradeExecutionsForOrders({
      apiKey: "key",
      apiSecret: "secret",
      nextNonce: async () => String(++nonce),
      exchangeOrderIds: ["ORDER-1"],
      startSeconds: 1_799_999_000,
      fetchPage: async (request) => {
        requests.push(request);
        return pages[requests.length - 1]!;
      },
    });

    expect(result.coverageComplete).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(result.accountRowsScanned).toBe(60);
    expect(result.trades.map((trade) => trade.tradeId)).toEqual(["T-1", "T-2"]);
    expect(requests.map((request) => request.nonce)).toEqual(["101", "102"]);
    expect(requests.map((request) => request.offset)).toEqual([0, 50]);
  });

  it("reports incomplete coverage when the safety page cap is reached", async () => {
    let calls = 0;
    const result = await fetchTradeExecutionsForOrders({
      apiKey: "key",
      apiSecret: "secret",
      nextNonce: async () => String(++calls),
      exchangeOrderIds: ["ORDER-1"],
      maxPages: 2,
      fetchPage: async () => ({ trades: [], returnedCount: 50, totalCount: 500 }),
    });

    expect(result.coverageComplete).toBe(false);
    expect(result.pagesFetched).toBe(2);
    expect(result.accountRowsScanned).toBe(100);
  });

  it("does not contact Kraken when there are no exchange order ids", async () => {
    let called = false;
    const result = await fetchTradeExecutionsForOrders({
      apiKey: "key",
      apiSecret: "secret",
      nextNonce: async () => "1",
      exchangeOrderIds: [],
      fetchPage: async () => {
        called = true;
        return { trades: [], returnedCount: 0, totalCount: 0 };
      },
    });
    expect(called).toBe(false);
    expect(result.coverageComplete).toBe(true);
  });
});
