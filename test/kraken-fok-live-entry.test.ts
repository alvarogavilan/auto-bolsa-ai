import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKrakenFokLimitFields } from "../src/kraken-fok-order";

const request = {
  pair: "PAXGEUR",
  type: "buy" as const,
  volume: "0.0012",
  price: "4000.00",
  clOrdId: "8f6bc772-b3af-4edc-a14d-e74b84b7cf10",
};

describe("Kraken FOK live entry parity", () => {
  it("forces FOK on the real entry payload", () => {
    expect(buildKrakenFokLimitFields(request)).toEqual({
      pair: "PAXGEUR",
      type: "buy",
      ordertype: "limit",
      volume: "0.0012",
      price: "4000.00",
      cl_ord_id: request.clOrdId,
      timeinforce: "FOK",
    });
  });

  it("keeps validate=true while preserving FOK", () => {
    expect(buildKrakenFokLimitFields({ ...request, validate: true })).toMatchObject({
      ordertype: "limit",
      timeinforce: "FOK",
      validate: "true",
    });
  });

  it("routes both preflight and real transport through the same FOK gateway", () => {
    const preflight = readFileSync("src/live-order-preflight.ts", "utf8");
    const transport = readFileSync("src/live-transport.ts", "utf8");
    expect(preflight).toContain("addKrakenFokLimitOrder");
    expect(transport).toContain("addKrakenFokLimitOrder");
    expect(preflight).not.toContain("return addOrder(");
    expect(transport).not.toContain("const result = await addOrder({");
  });
});
