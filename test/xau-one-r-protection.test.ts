import { describe, expect, it } from "vitest";
import { applyXauPaperPositionCycle, createXauPaperPositionBook, type XauPaperPositionBook } from "../src/xau-usd-paper-position";
import type { XauPaperInstruction, XauPaperRuntimeInput } from "../src/xau-usd-paper-runtime";

const holdInstruction: XauPaperInstruction = {
  schemaVersion: "xau-usd-paper-instruction-v1",
  createdAt: 1,
  market: "XAU/USD",
  mode: "paper",
  cycleKind: "monitoring",
  action: "hold",
  allowed: false,
  budgetEur: 0,
  referencePrice: null,
  stopPrice: null,
  initialTargetPrice: null,
  rewardRisk: 0,
  quoteAgeMs: 0,
  quoteSource: "test",
  cabinetDecision: {} as XauPaperInstruction["cabinetDecision"],
  sizing: {
    requestedMaximumEur: 0,
    confidenceFactor: 0,
    rewardRiskFactor: 0,
    volatilityFactor: 0,
    exposureHeadroomEur: 0,
    selectedBudgetEur: 0,
    rationale: ["Fixture de monitorización sin entrada."],
  },
  blockers: [],
  liveTrading: false,
  realOrderSubmission: false,
};

function openSellBook(): XauPaperPositionBook {
  const book = createXauPaperPositionBook();
  book.open = {
    id: "xau-test-sell",
    side: "sell",
    openedAt: 1,
    entryPrice: 4066.1,
    quantityOz: 0.002459,
    budgetEur: 10,
    estimatedRoundTripCostEur: 0.05,
    minimumMeaningfulNetProfitEur: 0.5,
    initialStopPrice: 4076.004878,
    stopPrice: 4076.004878,
    targetPrice: 4040.630313,
    highWaterPrice: 4066.1,
    lowWaterPrice: 4066.1,
    lastMarkPrice: 4066.1,
    lastMarkedAt: 1,
    trailingActive: false,
    protectedPnlEur: 0,
    grossUnrealizedPnlEur: 0,
    unrealizedPnlEur: -0.05,
    netBreakEvenPrice: 4045.765702,
  };
  book.metrics.opened = 1;
  book.treasury.cashEur = 90;
  book.treasury.committedCapitalEur = 10;
  book.treasury.availableCapitalEur = 90;
  return book;
}

function input(ask: number, observedAt: number): XauPaperRuntimeInput {
  return {
    now: observedAt,
    cabinet: {} as XauPaperRuntimeInput["cabinet"],
    quote: { bid: ask - 0.1, ask, observedAt, source: "test" },
    requestedBudgetEur: 10,
    cycleKind: "monitoring",
  };
}

describe("XAU net break-even protection", () => {
  it("does not label trailing active while gross profit is still below estimated costs", () => {
    const result = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4054.1, 2));

    expect(result.open).not.toBeNull();
    expect(result.open?.grossUnrealizedPnlEur).toBeGreaterThan(0);
    expect(result.open?.unrealizedPnlEur).toBeLessThan(0);
    expect(result.open?.trailingActive).toBe(false);
    expect(result.open?.protectedPnlEur).toBe(0);
    expect(result.open?.stopPrice).toBe(4076.004878);
    expect(result.liveTrading).toBe(false);
    expect(result.realOrderSubmission).toBe(false);
  });

  it("activates trailing only after costs are recovered and protects a non-negative net exit", () => {
    const result = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4044, 2));

    expect(result.open?.unrealizedPnlEur).toBeGreaterThan(0);
    expect(result.open?.trailingActive).toBe(true);
    expect(result.open?.stopPrice).toBeCloseTo(result.open?.netBreakEvenPrice as number, 5);
    expect(result.open?.stopPrice).toBeGreaterThan(4044);
    expect(result.open?.protectedPnlEur).toBeGreaterThanOrEqual(0);
  });

  it("never loosens the protected stop while a sell trend keeps advancing", () => {
    const first = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4044, 2));
    const firstStop = first.open?.stopPrice ?? Infinity;
    const second = applyXauPaperPositionCycle(first, holdInstruction, input(4038, 3));

    expect(second.open?.trailingActive).toBe(true);
    expect(second.open?.stopPrice).toBeLessThanOrEqual(firstStop);
    expect(second.open?.stopPrice).toBeGreaterThan(4038);
  });

  it("does not activate before the one-R threshold even if net break-even were reached", () => {
    const book = openSellBook();
    if (book.open) {
      book.open.quantityOz = 0.01;
      book.open.netBreakEvenPrice = 4061.1;
    }
    const result = applyXauPaperPositionCycle(book, holdInstruction, input(4057, 2));

    expect(result.open?.trailingActive).toBe(false);
    expect(result.open?.stopPrice).toBe(4076.004878);
  });
});
