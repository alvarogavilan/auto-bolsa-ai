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
  it("opens only one position and lets the winner run", () => {
    const firstInput = input(1_000);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    expect(book.open?.side).toBe("buy");
    expect(book.metrics.opened).toBe(1);

    const rally = input(2_000, 2412, 2412.2);
    const oldTarget = book.open?.targetPrice as number;
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(rally), rally);
    expect(book.metrics.opened).toBe(1);
    expect(book.open?.trailingActive).toBe(true);
    expect(book.open?.stopPrice).toBeGreaterThan(book.open?.entryPrice as number);
    expect(book.open?.protectedPnlEur).toBeGreaterThan(0);
    expect(book.open?.targetPrice).toBeGreaterThan(oldTarget);
  });

  it("closes through the raised stop while preserving a positive result", () => {
    const firstInput = input(1_000);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    const rally = input(2_000, 2412, 2412.2);
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(rally), rally);
    const protectedStop = book.open?.stopPrice as number;

    const reversal = input(3_000, protectedStop - 0.1, protectedStop + 0.1);
    reversal.cabinet.macro.highImpactEventWithinMinutes = 5;
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(reversal), reversal);
    expect(book.open).toBeNull();
    expect(book.metrics.closed).toBe(1);
    expect(book.metrics.winners).toBe(1);
    expect(book.metrics.realizedPnlEur).toBeGreaterThan(0);
    expect(book.closed[0]?.closeReason).toBe("stop");
  });
});
