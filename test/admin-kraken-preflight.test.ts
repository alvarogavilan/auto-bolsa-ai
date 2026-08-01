import { describe, expect, it } from "vitest";
import { KrakenApiError } from "../src/kraken";
import type { KrakenAssetPair, KrakenTicker } from "../src/kraken-markets";
import type { ValidateOnlyOrderGateway } from "../src/live-order-preflight";
import { runAdminKrakenValidateOnlyPreflight } from "../src/admin-kraken-preflight";

const CL_ORD_ID = "00000000-0000-4000-8000-000000000001";

const pair: KrakenAssetPair = {
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
};

const ticker: KrakenTicker = {
  ask: 50_000,
  bid: 49_990,
  last: 49_995,
  volume24h: 100,
  vwap24h: 49_500,
  trades24h: 1_000,
  low24h: 48_000,
  high24h: 51_000,
  open24h: 49_000,
};

describe("isolated admin Kraken preflight service", () => {
  it("uses the prepared clOrdId and emits a one-use certificate after validation", async () => {
    let nonceCalls = 0;
    let gatewayCalls = 0;
    let receivedValidate: boolean | undefined;
    let receivedClOrdId: string | undefined;
    const gateway: ValidateOnlyOrderGateway = {
      validate: async (request) => {
        gatewayCalls += 1;
        receivedValidate = request.validate;
        receivedClOrdId = request.clOrdId;
        return { txid: [], descr: { order: "validated only" } };
      },
    };

    const report = await runAdminKrakenValidateOnlyPreflight(
      {
        apiKey: "key",
        apiSecret: "secret",
        pair: "XBTEUR",
        clOrdId: CL_ORD_ID,
        nextNonce: async () => String(++nonceCalls),
        now: 1_800_000_000_000,
      },
      {
        fetchPairs: async () => [pair],
        fetchTickers: async () => ({ XXBTZEUR: ticker }),
        gatewayFactory: (_key, _secret, nextNonce) => ({
          validate: async (request) => {
            await nextNonce();
            return gateway.validate(request);
          },
        }),
      },
    );

    expect(gatewayCalls).toBe(1);
    expect(nonceCalls).toBe(1);
    expect(receivedValidate).toBe(true);
    expect(receivedClOrdId).toBe(CL_ORD_ID);
    expect(report.schemaVersion).toBe("admin-kraken-preflight-v2");
    expect(report.result.status).toBe("validated");
    expect(report.result.clOrdId).toBe(CL_ORD_ID);
    expect(report.orderCreated).toBe(false);
    expect(report.plan.intent.notionalEur).toBeLessThanOrEqual(5);
    expect(report.liveTrading).toBe(false);
    expect(report.certificate).not.toBeNull();
    expect(report.certificate?.clOrdId).toBe(CL_ORD_ID);
    expect(report.certificate?.intent).toEqual(report.plan.intent);
    expect(report.certificate?.consumedAt).toBeNull();
  });

  it("reports an explicit Kraken EOrder rejection without issuing a certificate", async () => {
    const report = await runAdminKrakenValidateOnlyPreflight(
      {
        apiKey: "key",
        apiSecret: "secret",
        pair: "XBTEUR",
        clOrdId: CL_ORD_ID,
        nextNonce: async () => "1",
      },
      {
        fetchPairs: async () => [pair],
        fetchTickers: async () => ({ XXBTZEUR: ticker }),
        gatewayFactory: () => ({
          validate: async () => { throw new KrakenApiError(["EOrder:Insufficient funds"]); },
        }),
      },
    );

    expect(report.result.status).toBe("rejected");
    expect(report.result.blockers).toEqual(["EOrder:Insufficient funds"]);
    expect(report.preflightComplete).toBe(true);
    expect(report.orderCreated).toBe(false);
    expect(report.certificate).toBeNull();
  });

  it("keeps a generic transport or authentication failure ambiguous and uncertified", async () => {
    const report = await runAdminKrakenValidateOnlyPreflight(
      {
        apiKey: "key",
        apiSecret: "secret",
        pair: "XBTEUR",
        clOrdId: CL_ORD_ID,
        nextNonce: async () => "1",
      },
      {
        fetchPairs: async () => [pair],
        fetchTickers: async () => ({ XXBTZEUR: ticker }),
        gatewayFactory: () => ({
          validate: async () => { throw new Error("network unavailable"); },
        }),
      },
    );

    expect(report.result.status).toBe("unknown");
    expect(report.preflightComplete).toBe(false);
    expect(report.orderCreated).toBeNull();
    expect(report.certificate).toBeNull();
  });

  it("never requests a nonce when public data cannot build a safe plan", async () => {
    let nonceCalls = 0;
    let gatewayCreated = false;

    await expect(runAdminKrakenValidateOnlyPreflight(
      {
        apiKey: "key",
        apiSecret: "secret",
        pair: "XBTEUR",
        clOrdId: CL_ORD_ID,
        nextNonce: async () => String(++nonceCalls),
      },
      {
        fetchPairs: async () => [{ ...pair, costmin: 10 }],
        fetchTickers: async () => ({ XXBTZEUR: ticker }),
        gatewayFactory: () => {
          gatewayCreated = true;
          return { validate: async () => ({ txid: [], descr: {} }) };
        },
      },
    )).rejects.toThrow(/supera el máximo del preflight/);

    expect(gatewayCreated).toBe(false);
    expect(nonceCalls).toBe(0);
  });

  it("fails closed for unknown market, offline pair or missing ticker", async () => {
    const baseConfig = {
      apiKey: "key",
      apiSecret: "secret",
      pair: "XBTEUR",
      clOrdId: CL_ORD_ID,
      nextNonce: async () => "1",
    };

    await expect(runAdminKrakenValidateOnlyPreflight(baseConfig, {
      fetchPairs: async () => [],
      fetchTickers: async () => ({}),
    })).rejects.toThrow(/no contiene/);

    await expect(runAdminKrakenValidateOnlyPreflight(baseConfig, {
      fetchPairs: async () => [{ ...pair, status: "cancel_only" }],
      fetchTickers: async () => ({ XXBTZEUR: ticker }),
    })).rejects.toThrow(/no está operativo/);

    await expect(runAdminKrakenValidateOnlyPreflight(baseConfig, {
      fetchPairs: async () => [pair],
      fetchTickers: async () => ({}),
    })).rejects.toThrow(/Ticker no contiene/);
  });

  it("rejects a missing prepared clOrdId before any network dependency is used", async () => {
    let dependencyCalled = false;
    await expect(runAdminKrakenValidateOnlyPreflight(
      {
        apiKey: "key",
        apiSecret: "secret",
        pair: "XBTEUR",
        clOrdId: "   ",
        nextNonce: async () => "1",
      },
      {
        fetchPairs: async () => {
          dependencyCalled = true;
          return [pair];
        },
      },
    )).rejects.toThrow(/Falta el clOrdId preparado/);
    expect(dependencyCalled).toBe(false);
  });
});
