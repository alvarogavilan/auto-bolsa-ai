import { describe, expect, it } from "vitest";
import { buildKrakenStopLossFields, validateKrakenGoldStopLoss } from "../src/kraken-stop-loss";

const base = {
  pair: "PAXGEUR",
  volumeBase: 0.0012,
  stopPrice: 2388.4,
  lotDecimals: 4,
  priceDecimals: 1,
  clOrdId: "2cfad3be-496e-44c8-9f6e-6dbeafe88e31",
};

describe("Kraken gold stop-loss gateway", () => {
  it("builds an explicit sell stop-loss request for PAXG/EUR", () => {
    expect(buildKrakenStopLossFields(base)).toEqual({
      pair: "PAXGEUR",
      type: "sell",
      ordertype: "stop-loss",
      volume: "0.0012",
      price: "2388.4",
      cl_ord_id: base.clOrdId,
    });
  });

  it("rejects non-gold instruments", () => {
    expect(validateKrakenGoldStopLoss({ ...base, pair: "XBTEUR" })).toContain(
      "Par de protección no permitido: XBTEUR",
    );
  });

  it("rejects volume or price that violate Kraken precision", () => {
    const blockers = validateKrakenGoldStopLoss({
      ...base,
      volumeBase: 0.00123,
      stopPrice: 2388.45,
    });
    expect(blockers).toContain("volumeBase no cuantizado a 4 decimales");
    expect(blockers).toContain("stopPrice no cuantizado a 1 decimales");
  });

  it("never exposes buy or limit semantics in the generated protection", () => {
    const fields = buildKrakenStopLossFields(base);
    expect(fields.type).toBe("sell");
    expect(fields.ordertype).toBe("stop-loss");
    expect(fields).not.toHaveProperty("validate");
  });
});
