import { describe, expect, it } from "vitest";
import { parseXauPaperPositionBook, type XauPaperPositionBook } from "../src/xau-usd-paper-position";

function modernBook(): XauPaperPositionBook {
  return {
    schemaVersion: "xau-usd-paper-position-book-v1",
    market: "XAU/USD",
    open: {
      id: "xau-open",
      side: "sell",
      openedAt: 100,
      entryPrice: 4066.1,
      quantityOz: 0.002459,
      budgetEur: 10,
      estimatedRoundTripCostEur: 0.05,
      minimumMeaningfulNetProfitEur: 0.5,
      initialStopPrice: 4076,
      stopPrice: 4076,
      targetPrice: 4040,
      highWaterPrice: 4067,
      lowWaterPrice: 4061,
      lastMarkPrice: 4066.9,
      lastMarkedAt: 300,
      trailingActive: false,
      protectedPnlEur: 0,
      grossUnrealizedPnlEur: -0.001967,
      unrealizedPnlEur: -0.051967,
      netBreakEvenPrice: 4045.765702,
    },
    closed: [],
    metrics: {
      opened: 1,
      closed: 0,
      winners: 0,
      losers: 0,
      realizedPnlEur: 0,
      unrealizedPnlEur: -0.051967,
      protectedPnlEur: 0,
    },
    treasury: {
      schemaVersion: "xau-paper-treasury-v1",
      initialCapitalEur: 100,
      cashEur: 90,
      committedCapitalEur: 10,
      realizedPnlEur: 0,
      unrealizedPnlEur: -0.051967,
      equityEur: 99.948033,
      availableCapitalEur: 90,
      migratedExistingPosition: true,
      equityCurve: [
        { observedAt: 300, cashEur: 90, committedCapitalEur: 10, realizedPnlEur: 0, unrealizedPnlEur: -0.051967, equityEur: 99.948033, event: "mark", positionId: "xau-open" },
        { observedAt: 200, cashEur: 90, committedCapitalEur: 10, realizedPnlEur: 0, unrealizedPnlEur: -0.05, equityEur: 99.95, event: "migration", positionId: "xau-open" },
        { observedAt: 300, cashEur: 90, committedCapitalEur: 10, realizedPnlEur: 0, unrealizedPnlEur: -0.051967, equityEur: 99.948033, event: "mark", positionId: "xau-open" },
      ],
    },
    liveTrading: false,
    realOrderSubmission: false,
  };
}

describe("XAU equity curve parsing", () => {
  it("does not append a point when reading a modern book", () => {
    const parsed = parseXauPaperPositionBook(JSON.stringify(modernBook()));
    expect(parsed.treasury.equityCurve).toHaveLength(2);
    expect(parsed.treasury.equityCurve.map((point) => point.observedAt)).toEqual([200, 300]);
  });

  it("is idempotent across repeated reads", () => {
    const first = parseXauPaperPositionBook(JSON.stringify(modernBook()));
    const second = parseXauPaperPositionBook(JSON.stringify(first));
    expect(second.treasury.equityCurve).toEqual(first.treasury.equityCurve);
  });
});
