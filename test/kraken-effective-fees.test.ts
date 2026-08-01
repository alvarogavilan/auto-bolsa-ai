import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKrakenEffectiveFeesAudit,
  fetchKrakenEffectiveFees,
} from "../src/kraken-fees";
import { summarizeKrakenEffectiveFees } from "../src/pilot-runtime";

const originalFetch = globalThis.fetch;

const PAYLOAD = {
  error: [],
  result: {
    currency: "ZEUR",
    volume: "12.5",
    inputs: {
      domain_spot_volume_30d: "12.5",
      domain_futures_volume_30d: "0",
      domain_assets_on_platform: "50",
    },
    fees: {
      XXBTZEUR: {
        fee: "0.8000",
        minfee: "0.1000",
        maxfee: "0.8000",
        nextfee: "0.7500",
        tiervolume: "0",
        nextvolume: "10000",
      },
    },
    fees_maker: {
      XXBTZEUR: {
        fee: "0.4000",
        minfee: "0.0000",
        maxfee: "0.4000",
        nextfee: "0.3500",
        tiervolume: "0",
        nextvolume: "10000",
      },
    },
  },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Kraken effective fee audit", () => {
  it("parses maker, taker and tier basis through the signed read-only request", async () => {
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
      return Response.json(PAYLOAD);
    }) as typeof fetch;

    const audit = await fetchKrakenEffectiveFees(
      "api-key",
      "c2VjcmV0",
      "1800000000001",
      "XBTEUR",
      0.004,
      1_800_000_000_000,
    );

    expect(audit.pairResolved).toBe("XXBTZEUR");
    expect(audit.taker?.percent).toBe(0.8);
    expect(audit.taker?.rate).toBe(0.008);
    expect(audit.maker?.percent).toBe(0.4);
    expect(audit.maker?.rate).toBe(0.004);
    expect(audit.volume30d).toBe(12.5);
    expect(audit.tierInputs.effectiveTierBasis).toBe(50);
    expect(audit.tierInputs.effectiveTierBasisSource).toBe("assets-on-platform");
    expect(audit.paperFeeMatchesCurrentTaker).toBe(false);
    expect(audit.paperTakerGapRate).toBe(0.004);
    expect(audit.recommendedPaperFeeEachSideRate).toBe(0.008);
    expect(audit.fiveEurTakerRoundTripFeeEur).toBeCloseTo(0.08, 10);
    expect(audit.changesStrategyParameters).toBe(false);
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

  it("rejects an ambiguous response instead of borrowing another pair fee", () => {
    expect(() => buildKrakenEffectiveFeesAudit({
      error: [],
      result: {
        fees: {
          ETHEUR: { fee: "0.8" },
          ADÄEUR: { fee: "0.8" },
        },
        fees_maker: {},
      },
    }, "XBTEUR", 0.004)).toThrow(/no unambiguous fee tier/i);
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

  it("publishes a safe readiness summary without turning missing values into zero", () => {
    const audit = buildKrakenEffectiveFeesAudit(PAYLOAD, "XBTEUR", 0.004, 1_800_000_000_000);
    const summary = summarizeKrakenEffectiveFees({
      effectiveFees: audit,
      effectiveFeesStatus: { available: true, error: null },
    });

    expect(summary.available).toBe(true);
    expect(summary.makerFeePercent).toBe(0.4);
    expect(summary.takerFeePercent).toBe(0.8);
    expect(summary.fiveEurTakerRoundTripFeeEur).toBeCloseTo(0.08, 10);
    expect(summary.permissionRequired).toBe("query-funds");
    expect(summary.changesStrategyParameters).toBe(false);
    expect(summary.realOrderCreated).toBe(false);

    const missing = summarizeKrakenEffectiveFees({
      effectiveFeesStatus: { available: false, error: "not available" },
    });
    expect(missing.available).toBe(false);
    expect(missing.makerFeePercent).toBeNull();
    expect(missing.takerFeePercent).toBeNull();
    expect(missing.fiveEurTakerRoundTripFeeEur).toBeNull();
    expect(missing.error).toBe("not available");
  });

  it("never returns credentials, nonce or signing material", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(PAYLOAD)) as typeof fetch;

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
