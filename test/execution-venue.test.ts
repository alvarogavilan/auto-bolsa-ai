import { afterEach, describe, expect, it, vi } from "vitest";
import { baseAssetOfPair, cryptoComInstrument, executionVenue, fetchVenueTickers, parseCryptoComTicker } from "../src/execution-venue";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("execution venue", () => {
  it("defaults to Crypto.com and only switches to Kraken explicitly", () => {
    expect(executionVenue({}).id).toBe("cryptocom");
    expect(executionVenue({ EXECUTION_VENUE: "kraken" }).id).toBe("kraken");
  });

  it("maps Kraken signal pairs to Crypto.com EUR instruments", () => {
    expect(cryptoComInstrument("PAXGEUR")).toBe("PAXG_EUR");
    expect(cryptoComInstrument("XXBTZEUR")).toBe("BTC_EUR");
    expect(cryptoComInstrument("XBTEUR")).toBe("BTC_EUR");
    expect(cryptoComInstrument("XETHZEUR")).toBe("ETH_EUR");
    expect(cryptoComInstrument("SOLEUR")).toBe("SOL_EUR");
    expect(baseAssetOfPair("XDGEUR")).toBe("DOGE");
  });

  it("parses both ticker formats and rejects empty books", () => {
    const short = parseCryptoComTicker({ i: "BTC_EUR", b: "61948.51", k: "61993.96", a: "62005.73", c: "-0.04" });
    expect(short?.bid).toBe(61948.51);
    expect(short?.ask).toBe(61993.96);
    expect(short?.open24h).toBeCloseTo(62005.73 / 0.96);
    expect(parseCryptoComTicker({ best_bid: "1", best_ask: "2", last: "1.5", change: "0" })?.ask).toBe(2);
    expect(parseCryptoComTicker({ b: "0", k: "0" })).toBeNull();
  });

  it("returns prices keyed by signal pair and omits instruments the venue lacks", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("PAXG_EUR")) return Response.json({ result: { data: [{ i: "PAXG_EUR", b: "3513", k: "3521", a: "3514" }] } });
      return Response.json({ result: { data: [] } });
    }) as typeof fetch;
    const tickers = await fetchVenueTickers({}, ["PAXGEUR", "RAREEUR"]);
    expect(Object.keys(tickers)).toEqual(["PAXGEUR"]);
    expect(tickers.PAXGEUR?.ask).toBe(3521);
  });

  it("throws when the venue is completely unreachable", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("down"); }) as typeof fetch;
    await expect(fetchVenueTickers({}, ["PAXGEUR"])).rejects.toThrow("Crypto.com sin respuesta");
  });
});
