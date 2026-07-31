import { describe, expect, it } from "vitest";
import {
  reconcileFillEvidence,
  type ExpectedOrderExecution,
  type LiveTradeExecution,
} from "../src/live-fill-evidence";

function expected(overrides: Partial<ExpectedOrderExecution> = {}): ExpectedOrderExecution {
  return {
    exchangeOrderId: "ORDER-1",
    acceptedPairCodes: ["XBTEUR", "XXBTZEUR", "XBT/EUR"],
    side: "buy",
    volumeExecutedBase: 0.0003,
    averagePrice: 50_000,
    lotDecimals: 8,
    priceDecimals: 1,
    ...overrides,
  };
}

function trade(id: string, overrides: Partial<LiveTradeExecution> = {}): LiveTradeExecution {
  return {
    tradeId: id,
    exchangeOrderId: "ORDER-1",
    pair: "XXBTZEUR",
    side: "buy",
    timestampSeconds: 1_800_000_000,
    price: 50_000,
    costQuote: 5,
    feeQuote: 0.04,
    volumeBase: 0.0001,
    maker: false,
    ...overrides,
  };
}

describe("fill-level evidence", () => {
  it("certifies volume, weighted price, fees and liquidity from individual fills", () => {
    const result = reconcileFillEvidence(expected(), [
      trade("T-1", { costQuote: 5, volumeBase: 0.0001, maker: true }),
      trade("T-2", { costQuote: 10, volumeBase: 0.0002, maker: false, timestampSeconds: 1_800_000_001 }),
    ], true);

    expect(result.status).toBe("consistent");
    expect(result.summary.tradeIds).toEqual(["T-1", "T-2"]);
    expect(result.summary.volumeBase).toBe(0.0003);
    expect(result.summary.costQuote).toBe(15);
    expect(result.summary.feeQuote).toBe(0.08);
    expect(result.summary.averagePrice).toBe(50_000);
    expect(result.summary.makerCount).toBe(1);
    expect(result.summary.takerCount).toBe(1);
  });

  it("deduplicates an identical trade id produced by overlapping pagination", () => {
    const one = trade("T-DUP", { volumeBase: 0.0003, costQuote: 15 });
    const result = reconcileFillEvidence(expected(), [one, { ...one }], true);
    expect(result.status).toBe("consistent");
    expect(result.summary.tradeCount).toBe(1);
  });

  it("rejects a duplicate trade id whose payload changed", () => {
    const one = trade("T-CONFLICT", { volumeBase: 0.0003, costQuote: 15 });
    const result = reconcileFillEvidence(expected(), [one, { ...one, feeQuote: 99 }], true);
    expect(result.status).toBe("inconsistent");
    expect(result.reason).toMatch(/contradictorios/);
  });

  it("fails closed when pagination is incomplete", () => {
    const result = reconcileFillEvidence(expected(), [trade("T-1")], false);
    expect(result.status).toBe("unknown");
    expect(result.summary.tradeCount).toBe(0);
  });

  it("detects pair, side and executed-volume mismatches", () => {
    expect(reconcileFillEvidence(expected(), [trade("T-PAIR", { pair: "ETHEUR" })], true).status).toBe("inconsistent");
    expect(reconcileFillEvidence(expected(), [trade("T-SIDE", { side: "sell" })], true).status).toBe("inconsistent");
    expect(reconcileFillEvidence(expected(), [trade("T-VOL")], true).status).toBe("inconsistent");
  });

  it("requires a remote average price whenever fills exist", () => {
    const result = reconcileFillEvidence(
      expected({ averagePrice: null, volumeExecutedBase: 0.0001 }),
      [trade("T-AVG")],
      true,
    );
    expect(result.status).toBe("unknown");
  });

  it("accepts a genuinely unfilled order only when no fills exist", () => {
    const empty = reconcileFillEvidence(expected({ volumeExecutedBase: 0, averagePrice: null }), [], true);
    expect(empty.status).toBe("consistent");

    const contradiction = reconcileFillEvidence(
      expected({ volumeExecutedBase: 0, averagePrice: null }),
      [trade("T-GHOST")],
      true,
    );
    expect(contradiction.status).toBe("inconsistent");
  });
});
