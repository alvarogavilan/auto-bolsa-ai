import { describe, expect, it } from "vitest";
import { applyXauPaperPositionCycle, createXauPaperPositionBook, parseXauPaperPositionBook } from "../src/xau-usd-paper-position";
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
  it("reserves capital and marks the treasury while the position is open", () => {
    const firstInput = input(1_000);
    const book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    expect(book.open?.budgetEur).toBe(10);
    expect(book.treasury.committedCapitalEur).toBe(10);
    expect(book.treasury.cashEur).toBe(90);
    expect(book.treasury.unrealizedPnlEur).toBe(book.open?.unrealizedPnlEur);
    expect(book.treasury.equityEur).toBe(100 + (book.open?.unrealizedPnlEur ?? 0));
    expect(book.treasury.equityCurve.at(-1)?.event).toBe("open");
  });

  it("migrates an already-open legacy position without duplicating capital", () => {
    const firstInput = input(1_000);
    const current = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    delete legacy.treasury;
    const migrated = parseXauPaperPositionBook(JSON.stringify(legacy));
    expect(migrated.treasury.migratedExistingPosition).toBe(true);
    expect(migrated.treasury.committedCapitalEur).toBe(10);
    expect(migrated.treasury.cashEur).toBe(90);
    expect(migrated.treasury.equityCurve.at(-1)?.event).toBe("migration");
  });

  it("does not activate protection before the move reaches one risk unit", () => {
    const firstInput = input(1_000);
    let book = applyXauPaperPositionCycle(createXauPaperPositionBook(), buildXauUsdPaperInstruction(firstInput), firstInput);
    const subOneRMove = input(2_000, 2408, 2408.2);
    book = applyXauPaperPositionCycle(book, buildXauUsdPaperInstruction(subOneRMove), subOneRMove);
    expect(book.open?.trailingActive).toBe(false);
    expect(book.open?.protectedPnlEur).toBe(0);
    expect(book.open?.unrealizedPnlEur).toBeLessThan(0.5);
    expect(book.treasury.equityCurve.at(-1)?.event).toBe("mark");
  });

  it("lets a meaningful winner run, closes coherently and releases capital", () => {
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
    expect(book.treasury.committedCapitalEur).toBe(0);
    expect(book.treasury.cashEur).toBe(100 + book.metrics.realizedPnlEur);
    expect(book.treasury.equityEur).toBe(book.treasury.cashEur);
    expect(book.treasury.equityCurve.at(-1)?.event).toBe("close");
  });
});
