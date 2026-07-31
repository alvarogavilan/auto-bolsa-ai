import { describe, expect, it } from "vitest";
import { KrakenApiError } from "../src/kraken";
import {
  runValidateOnlyOrderPreflight,
  type ValidateOnlyKrakenCall,
} from "../src/live-order-preflight";

const metadata = { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 };
const intent = {
  pair: "XBTEUR",
  side: "buy" as const,
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

describe("validate-only Kraken order preflight", () => {
  it("forces validate=true and accepts only an empty txid response", async () => {
    let captured: ValidateOnlyKrakenCall | null = null;
    const result = await runValidateOnlyOrderPreflight({
      intent,
      metadata,
      apiKey: "public-key",
      apiSecret: "private-secret",
      nonce: "123",
      now: 1_800_000_000_000,
      submit: async (call) => {
        captured = call;
        return { txid: [], descr: { order: "buy 0.0001 XBTEUR @ limit 50000" } };
      },
    });

    expect(captured?.request.validate).toBe(true);
    expect(captured?.request.ordertype).toBe("limit");
    expect(captured?.request.type).toBe("buy");
    expect(result.accepted).toBe(true);
    expect(result.validateOnly).toBe(true);
    expect(result.orderCreated).toBe(false);
    expect(result.liveTrading).toBe(false);
  });

  it("treats any returned txid as a critical contract violation", async () => {
    await expect(runValidateOnlyOrderPreflight({
      intent,
      metadata,
      apiKey: "public-key",
      apiSecret: "private-secret",
      nonce: "123",
      submit: async () => ({ txid: ["REAL-ORDER-ID"], descr: {} }),
    })).rejects.toThrow(/VIOLACIÓN DE SEGURIDAD/);
  });

  it("blocks malformed, imprecise or oversized intents before contacting Kraken", async () => {
    let calls = 0;
    const submit = async () => {
      calls += 1;
      return { txid: [], descr: {} };
    };

    await expect(runValidateOnlyOrderPreflight({
      intent: { ...intent, notionalEur: 5.5, volumeBase: 0.00011 },
      metadata,
      apiKey: "key",
      apiSecret: "secret",
      nonce: "1",
      submit,
    })).rejects.toThrow(/no admite más de 5 EUR/);

    await expect(runValidateOnlyOrderPreflight({
      intent: { ...intent, volumeBase: 0.000100001 },
      metadata,
      apiKey: "key",
      apiSecret: "secret",
      nonce: "2",
      submit,
    })).rejects.toThrow(/no está cuantizado/);

    expect(calls).toBe(0);
  });

  it("rejects a runtime-manipulated sell side before contacting Kraken", async () => {
    let calls = 0;
    const manipulated = { ...intent, side: "sell" } as unknown as typeof intent;

    await expect(runValidateOnlyOrderPreflight({
      intent: manipulated,
      metadata,
      apiKey: "key",
      apiSecret: "secret",
      nonce: "3",
      submit: async () => {
        calls += 1;
        return { txid: [], descr: {} };
      },
    })).rejects.toThrow(/solo admite compras límite validate-only/);

    expect(calls).toBe(0);
  });

  it("returns an explicit validate-only rejection for EOrder errors", async () => {
    const result = await runValidateOnlyOrderPreflight({
      intent,
      metadata,
      apiKey: "key",
      apiSecret: "secret",
      nonce: "1",
      submit: async () => { throw new KrakenApiError(["EOrder:Insufficient funds"]); },
    });

    expect(result.accepted).toBe(false);
    expect(result.orderCreated).toBe(false);
    expect(result.rejectionCodes).toEqual(["EOrder:Insufficient funds"]);
  });

  it("does not disguise transport, nonce or authentication failures as order rejections", async () => {
    await expect(runValidateOnlyOrderPreflight({
      intent,
      metadata,
      apiKey: "key",
      apiSecret: "secret",
      nonce: "1",
      submit: async () => { throw new KrakenApiError(["EAPI:Invalid nonce"]); },
    })).rejects.toThrow(/Invalid nonce/);
  });
});
