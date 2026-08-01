import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKrakenEffectiveFees } from "../src/kraken-fees";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Kraken effective fee audit", () => {
  it("parses maker and taker percentages into decimal rates", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let requestBody = "";
    let requestApiKey: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requestUrl = request.url;
      requestMethod = request.method;
      requestBody = await request.clone().text();
      requestApiKey = request.headers.get("API-Key");
      return Response.json({
        error: [],
        result: {
          currency: "ZEUR",
          volume: "0.0000",
          inputs: { domain_spot_volume_30d: "0.0000" },
          fees: {
            XXBTZEUR: {
              fee: "0.4000",
              minfee: "0.1000",
              maxfee: "0.4000",
              nextfee: "0.3500",
              tiervolume: "0.0000",
              nextvolume: "10000.0000",
            },
          },
          fees_maker: {
            XXBTZEUR: {
              fee: "0.2500",
              minfee: "0.0000",
              maxfee: "0.2500",
              nextfee: "0.2000",
              tiervolume: "0.0000",
              nextvolume: "10000.0000",
            },
          },
        },
      });
    }) as typeof fetch;

    const audit = await fetchKrakenEffectiveFees(
      "api-key",
      "c2VjcmV0",
      "1800000000001",
      "XBTEUR",
      0.004,
      1_800_000_000_000,
    );

    expect(audit.taker?.pair).toBe("XXBTZEUR");
    expect(audit.taker?.percent).toBe(0.4);
    expect(audit.taker?.rate).toBe(0.004);
    expect(audit.maker?.percent).toBe(0.25);
    expect(audit.maker?.rate).toBe(0.0025);
    expect(audit.volume30d).toBe(0);
    expect(audit.paperFeeMatchesCurrentTaker).toBe(true);
    expect(audit.recommendedPaperFeeEachSideRate).toBe(0.004);
    expect(audit.readOnly).toBe(true);
    expect(audit.realOrderCreated).toBe(false);
    expect(audit.liveTrading).toBe(false);

    expect(requestUrl).toBe("https://api.kraken.com/0/private/TradeVolume");
    expect(requestMethod).toBe("POST");
    expect(requestBody).toContain("nonce=1800000000001");
    expect(requestBody).toContain("pair=XBTEUR");
    expect(requestBody).toContain("fee-info=true");
    expect(requestBody).toContain("fee_schedule=true");
    expect(requestApiKey).toBe("api-key");
  });

  it("reports when the static PAPER fee differs from the account taker fee", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      error: [],
      result: {
        fees: { XBTEUR: { fee: "0.2600" } },
        fees_maker: { XBTEUR: { fee: "0.1600" } },
      },
    })) as typeof fetch;

    const audit = await fetchKrakenEffectiveFees(
      "api-key",
      "c2VjcmV0",
      "1800000000002",
      "XBTEUR",
      0.004,
    );

    expect(audit.taker?.rate).toBe(0.0026);
    expect(audit.maker?.rate).toBe(0.0016);
    expect(audit.paperFeeMatchesCurrentTaker).toBe(false);
    expect(audit.recommendedPaperFeeEachSideRate).toBe(0.0026);
  });

  it("fails closed on Kraken errors and malformed results", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      error: ["EAPI:Permission denied"],
      result: null,
    })) as typeof fetch;

    await expect(fetchKrakenEffectiveFees(
      "api-key",
      "c2VjcmV0",
      "1800000000003",
      "XBTEUR",
      0.004,
    )).rejects.toThrow("EAPI:Permission denied");
  });

  it("never returns credentials or signing material", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      error: [],
      result: { fees: { XBTEUR: { fee: "0.4000" } } },
    })) as typeof fetch;

    const audit = await fetchKrakenEffectiveFees(
      "visible-api-key",
      "c2VjcmV0",
      "1800000000004",
      "XBTEUR",
      0.004,
    );
    const serialized = JSON.stringify(audit);

    expect(serialized).not.toContain("visible-api-key");
    expect(serialized).not.toContain("c2VjcmV0");
    expect(serialized).not.toContain("1800000000004");
    expect(serialized).not.toContain("API-Sign");
  });
});
