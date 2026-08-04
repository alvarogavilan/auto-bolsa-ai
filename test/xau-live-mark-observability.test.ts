import { describe, expect, it } from "vitest";
import { applyXauPaperPositionCycle, createXauPaperPositionBook } from "../src/xau-usd-paper-position";
import { buildXauUsdPaperInstruction, type XauPaperRuntimeInput } from "../src/xau-usd-paper-runtime";

function input(now: number, bid: number, ask: number): XauPaperRuntimeInput {
  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid, ask, observedAt: now - 50, source: "test-feed" },
    cabinet: {
      symbol: "XAU/USD",
      session: "overlap",
      technical: {
        trendBias: "long", marketStructureBias: "long", liquidityBias: "long", momentumBias: "long",
        volatilityPct: 0.8, spreadPct: 0.02, distanceToInvalidationPct: 0.4, projectedMovePct: 1.2,
      },
      macro: {
        dxyBiasForGold: "long", realYieldsBiasForGold: "long", centralBankBias: "long",
        inflationBias: "long", geopoliticalBias: "long", highImpactEventWithinMinutes: 90,
        sourcesAvailable: 6, sourcesFresh: 6,
      },
      openXauExposureEur: 0,
      paperEquityEur: 100,
    },
  };
}

describe("XAU PAPER live mark observability", () => {
  it("persists the exact conservative mark and tick timestamp used for PnL", () => {
    const opening = input(1_000, 2_399.8, 2_400);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(opening), opening);
    const marked = input(2_000, 2_405, 2_405.2);
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(marked), marked);
    expect(book.open?.lastMarkPrice).toBe(2_405);
    expect(book.open?.lastMarkedAt).toBe(1_950);
    expect(book.open?.unrealizedPnlEur).not.toBe(-book.open!.estimatedRoundTripCostEur);
  });
});
