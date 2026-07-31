import { describe, expect, it } from "vitest";
import { buildValidateOnlyBuyPlan } from "../src/live-preflight-plan";

const metadata = { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 };

describe("validate-only buy plan", () => {
  it("uses the public ask, rounds price and floors volume below the 5 EUR cap", () => {
    const plan = buildValidateOnlyBuyPlan({
      pair: "XBTEUR",
      askPrice: 50_000.04,
      metadata,
      costMinQuote: 0.5,
    });

    expect(plan.intent.side).toBe("buy");
    expect(plan.intent.limitPrice).toBe(50_000);
    expect(plan.intent.volumeBase).toBe(0.0001);
    expect(plan.intent.notionalEur).toBe(5);
    expect(plan.intent.notionalEur).toBeLessThanOrEqual(5);
    expect(plan.source.price).toBe("kraken-public-ask");
  });

  it("never rounds volume upward beyond the configured budget", () => {
    const plan = buildValidateOnlyBuyPlan({
      pair: "ETHEUR",
      askPrice: 3_333.3,
      metadata: { orderMinBase: 0.0001, lotDecimals: 5, priceDecimals: 1 },
      costMinQuote: 0.5,
      requestedNotionalEur: 4.25,
      maxNotionalEur: 5,
    });

    expect(plan.intent.volumeBase).toBe(0.00127);
    expect(plan.intent.notionalEur).toBeLessThanOrEqual(4.25);
  });

  it("blocks when costmin or ordermin cannot be met within 5 EUR", () => {
    expect(() => buildValidateOnlyBuyPlan({
      pair: "EXPENSIVEEUR",
      askPrice: 100_000,
      metadata: { orderMinBase: 0.001, lotDecimals: 8, priceDecimals: 1 },
      costMinQuote: 0.5,
    })).toThrow(/no alcanza ordermin/);

    expect(() => buildValidateOnlyBuyPlan({
      pair: "COSTMINEUR",
      askPrice: 10,
      metadata: { orderMinBase: 0.1, lotDecimals: 2, priceDecimals: 2 },
      costMinQuote: 10,
    })).toThrow(/supera el máximo del preflight/);
  });

  it("rejects invalid public data and any attempt to raise the cap", () => {
    expect(() => buildValidateOnlyBuyPlan({
      pair: "XBTEUR",
      askPrice: 0,
      metadata,
      costMinQuote: 0.5,
    })).toThrow(/Ask público inválido/);

    expect(() => buildValidateOnlyBuyPlan({
      pair: "XBTEUR",
      askPrice: 50_000,
      metadata,
      costMinQuote: 0.5,
      maxNotionalEur: 5.01,
    })).toThrow(/entre 0 y 5 EUR/);
  });
});
