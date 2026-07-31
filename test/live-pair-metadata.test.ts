import { describe, expect, it } from "vitest";
import type { KrakenAssetPair } from "../src/kraken-markets";
import { resolveLivePairMetadata, resolveLivePairResolution } from "../src/live-pair-metadata";

function pair(overrides: Partial<KrakenAssetPair> = {}): KrakenAssetPair {
  return {
    key: "XXBTZEUR",
    altname: "XBTEUR",
    wsname: "XBT/EUR",
    base: "XXBT",
    quote: "ZEUR",
    ordermin: 0.00005,
    costmin: 0.5,
    pairDecimals: 1,
    lotDecimals: 8,
    tickSize: 0.1,
    status: "online",
    ...overrides,
  };
}

describe("LIVE pair metadata from Kraken AssetPairs", () => {
  it("matches the configured pair through key, altname or wsname", () => {
    const pairs = [pair()];
    expect(resolveLivePairMetadata(pairs, "XXBTZEUR")).toEqual({
      orderMinBase: 0.00005,
      lotDecimals: 8,
      priceDecimals: 1,
    });
    expect(resolveLivePairMetadata(pairs, "XBTEUR")).toEqual({
      orderMinBase: 0.00005,
      lotDecimals: 8,
      priceDecimals: 1,
    });
    expect(resolveLivePairMetadata(pairs, "xbt/eur")).toEqual({
      orderMinBase: 0.00005,
      lotDecimals: 8,
      priceDecimals: 1,
    });
  });

  it("preserves exact Kraken aliases for order and TradesHistory evidence", () => {
    const resolution = resolveLivePairResolution([pair()], "XBTEUR");
    expect(resolution.canonicalPair).toBe("XXBTZEUR");
    expect(resolution.acceptedPairCodes).toEqual(expect.arrayContaining([
      "XXBTZEUR",
      "XBTEUR",
      "XBT/EUR",
    ]));
    expect(resolution.metadata).toEqual({
      orderMinBase: 0.00005,
      lotDecimals: 8,
      priceDecimals: 1,
    });
  });

  it("fails closed for unknown or non-online markets", () => {
    expect(() => resolveLivePairMetadata([pair()], "ETHEUR")).toThrow(/no contiene/);
    expect(() => resolveLivePairMetadata([pair({ status: "cancel_only" })], "XBTEUR"))
      .toThrow(/no está operativo/);
  });

  it("rejects invalid minimum and precision data instead of inventing defaults", () => {
    expect(() => resolveLivePairMetadata([pair({ ordermin: 0 })], "XBTEUR"))
      .toThrow(/ordermin inválido/);
    expect(() => resolveLivePairMetadata([pair({ lotDecimals: -1 })], "XBTEUR"))
      .toThrow(/lot_decimals inválido/);
    expect(() => resolveLivePairMetadata([pair({ pairDecimals: 1.5 })], "XBTEUR"))
      .toThrow(/pair_decimals inválido/);
  });
});
