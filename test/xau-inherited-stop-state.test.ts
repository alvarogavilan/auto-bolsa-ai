import { describe, expect, it } from "vitest";
import { parseXauPaperPositionBook, type XauPaperPositionBook } from "../src/xau-usd-paper-position";

function book(): XauPaperPositionBook {
  return {
    schemaVersion: "xau-usd-paper-position-book-v1",
    market: "XAU/USD",
    open: {
      id: "xau-open",
      side: "sell",
      openedAt: 1,
      entryPrice: 4066.1,
      quantityOz: 0.002459,
      budgetEur: 10,
      estimatedRoundTripCostEur: 0.05,
      minimumMeaningfulNetProfitEur: 0.5,
      initialStopPrice: 4076.004878,
      stopPrice: 4059.628659,
      targetPrice: 4040.630313,
      highWaterPrice: 4066.1,
      lowWaterPrice: 4054.5,
      lastMarkPrice: 4054.5,
      lastMarkedAt: 2,
      trailingActive: true,
      protectedPnlEur: 0,
      grossUnrealizedPnlEur: 0.028523,
      unrealizedPnlEur: -0.021477,
      netBreakEvenPrice: 4045.765702,
    },
    closed: [],
    metrics: { opened: 1, closed: 0, winners: 0, losers: 0, realizedPnlEur: 0, unrealizedPnlEur: -0.021477, protectedPnlEur: 0 },
    treasury: {
      schemaVersion: "xau-paper-treasury-v1",
      initialCapitalEur: 100,
      cashEur: 90,
      committedCapitalEur: 10,
      realizedPnlEur: 0,
      unrealizedPnlEur: -0.021477,
      equityEur: 99.978523,
      availableCapitalEur: 90,
      equityCurve: [],
      migratedExistingPosition: true,
    },
    liveTrading: false,
    realOrderSubmission: false,
  };
}

describe("XAU inherited stop normalization", () => {
  it("keeps the reduced stop but disables trailing when it does not protect net profit", () => {
    const parsed = parseXauPaperPositionBook(JSON.stringify(book()));
    expect(parsed.open?.stopPrice).toBe(4059.628659);
    expect(parsed.open?.trailingActive).toBe(false);
    expect(parsed.open?.protectedPnlEur).toBe(0);
  });
});
