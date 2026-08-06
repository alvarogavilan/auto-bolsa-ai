import { describe, expect, it } from "vitest";
import { buildKrakenGoldProtectionPlan } from "../src/kraken-gold-protection";

const base = {
  entryPrice: 2400,
  currentPrice: 2405,
  highestPrice: 2405,
  tickSize: 0.1,
  initialStopPct: 0.01,
  breakEvenTriggerPct: 0.006,
  trailingTriggerPct: 0.012,
  trailingDistancePct: 0.005,
  roundTripFeePct: 0.016,
  previousStopPrice: null,
};

describe("Kraken gold protection policy", () => {
  it("starts with a quantized initial stop", () => {
    const plan = buildKrakenGoldProtectionPlan(base);
    expect(plan.mode).toBe("initial");
    expect(plan.initialStopPrice).toBe(2376);
    expect(plan.effectiveStopPrice).toBe(2376);
  });

  it("moves to fee-aware break-even after the trigger", () => {
    const plan = buildKrakenGoldProtectionPlan({
      ...base,
      currentPrice: 2440,
      highestPrice: 2440,
    });
    expect(plan.mode).toBe("break-even");
    expect(plan.breakEvenPrice).toBe(2438.4);
    expect(plan.effectiveStopPrice).toBe(2438.4);
  });

  it("trails from the verified peak without widening an existing stop", () => {
    const plan = buildKrakenGoldProtectionPlan({
      ...base,
      currentPrice: 2470,
      highestPrice: 2490,
      previousStopPrice: 2445,
    });
    expect(plan.mode).toBe("trailing");
    expect(plan.trailingCandidatePrice).toBe(2477.5);
    expect(plan.effectiveStopPrice).toBe(2469.9);
  });

  it("fails closed when the existing stop cannot remain below market", () => {
    expect(() => buildKrakenGoldProtectionPlan({
      ...base,
      currentPrice: 2390,
      highestPrice: 2405,
      previousStopPrice: 2395,
    })).toThrow("Protection would widen existing risk");
  });
});
