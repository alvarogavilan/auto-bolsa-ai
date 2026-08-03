import { describe, expect, it } from "vitest";
import { applyXauPaperPositionCycle, createXauPaperPositionBook } from "../src/xau-usd-paper-position";
import { buildXauUsdPaperInstruction, type XauPaperRuntimeInput } from "../src/xau-usd-paper-runtime";

function input(now: number, bid = 2399.8, ask = 2400): XauPaperRuntimeInput {
  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid, ask, observedAt: now - 100, source: "test-feed" },
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

describe("XAU/USD PAPER position lifecycle", () => {
  it("does not activate a penny-profit trailing exit", () => {
    const firstInput = input(1_000);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    const tinyRally = input(2_000, 2412, 2412.2);
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(tinyRally), tinyRally);
    expect(book.open?.trailingActive).toBe(false);
    expect(book.open?.protectedPnlEur).toBe(0);
    expect(book.open?.unrealizedPnlEur).toBeLessThan(0.5);
  });

  it("lets a meaningful winner run and protects at least fifty cents net", () => {
    const firstInput = input(1_000);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    const rally = input(2_000, 2600, 2600.2);
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(rally), rally);
    expect(book.open?.trailingActive).toBe(true);
    expect(book.open?.protectedPnlEur).toBeGreaterThanOrEqual(0.5);

    const protectedStop = book.open?.stopPrice as number;
    const reversal = input(3_000, protectedStop - 0.1, protectedStop + 0.1);
    reversal.cabinet.macro.highImpactEventWithinMinutes = 5;
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(reversal), reversal);
    expect(book.open).toBeNull();
    expect(book.metrics.winners).toBe(1);
    expect(book.metrics.realizedPnlEur).toBeGreaterThanOrEqual(0.5);
    expect(book.closed[0]?.grossPnlEur).toBeGreaterThan(book.closed[0]?.realizedPnlEur as number);
  });
});
