import { describe, expect, it } from "vitest";
import { selectKrakenGoldInstrument } from "../src/kraken-gold-instrument";
import type { KrakenAssetPair } from "../src/kraken-markets";

function pair(overrides: Partial<KrakenAssetPair>): KrakenAssetPair {
  return {
    key: "PAXGEUR",
    altname: "PAXGEUR",
    wsname: "PAXG/EUR",
    base: "PAXG",
    quote: "ZEUR",
    ordermin: 0.0001,
    costmin: 5,
    pairDecimals: 2,
    lotDecimals: 4,
    tickSize: 0.01,
    status: "online",
    ...overrides,
  };
}

describe("Kraken gold instrument discovery", () => {
  it("selects a tradable PAXG/EUR instrument and preserves execution restrictions", () => {
    const selected = selectKrakenGoldInstrument([pair({})], 1234);
    expect(selected).toMatchObject({
      broker: "kraken",
      asset: "gold",
      token: "PAXG",
      pairKey: "PAXGEUR",
      symbol: "PAXG/EUR",
      quote: "EUR",
      orderMinBase: 0.0001,
      costMinQuote: 5,
      lotDecimals: 4,
      priceDecimals: 2,
      tickSize: 0.01,
      tradable: true,
      verifiedAt: 1234,
    });
  });

  it("falls back to XAUT/EUR when PAXG/EUR is unavailable", () => {
    const selected = selectKrakenGoldInstrument([
      pair({ key: "XAUTZEUR", altname: "XAUTZEUR", wsname: "XAUT/EUR", base: "XAUT" }),
    ], 2000);
    expect(selected?.token).toBe("XAUT");
    expect(selected?.symbol).toBe("XAUT/EUR");
  });

  it("prefers an online XAUT/EUR pair over an offline PAXG/EUR pair", () => {
    const selected = selectKrakenGoldInstrument([
      pair({ status: "offline" }),
      pair({ key: "XAUTZEUR", altname: "XAUTZEUR", wsname: "XAUT/EUR", base: "XAUT", status: "online" }),
    ]);
    expect(selected?.token).toBe("XAUT");
    expect(selected?.tradable).toBe(true);
  });

  it("rejects gold pairs that are not quoted in EUR", () => {
    const selected = selectKrakenGoldInstrument([
      pair({ key: "PAXGUSD", altname: "PAXGUSD", wsname: "PAXG/USD", quote: "ZUSD" }),
    ]);
    expect(selected).toBeNull();
  });
});
