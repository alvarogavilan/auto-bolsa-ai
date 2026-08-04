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
    unrealizedPnlEur: -0.05,
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

describe("XAU one-R protection", () => {
  it("activates trailing after one risk unit even when costs keep net PnL slightly negative", () => {
    const result = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4056.1, 2));

    expect(result.open).not.toBeNull();
    expect(result.open?.trailingActive).toBe(true);
    expect(result.open?.stopPrice).toBeLessThan(4066.1);
    expect(result.open?.stopPrice).toBeGreaterThan(4056.1);
    expect(result.open?.stopPrice).toBeLessThan(4076.004878);
    expect(result.open?.targetPrice).toBeLessThanOrEqual(4040.630313);
    expect(result.liveTrading).toBe(false);
    expect(result.realOrderSubmission).toBe(false);
  });

  it("never loosens the protected stop while a sell trend keeps advancing", () => {
    const first = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4056.1, 2));
    const firstStop = first.open?.stopPrice ?? Infinity;
    const second = applyXauPaperPositionCycle(first, holdInstruction, input(4050, 3));

    expect(second.open?.trailingActive).toBe(true);
    expect(second.open?.stopPrice).toBeLessThanOrEqual(firstStop);
    expect(second.open?.stopPrice).toBeGreaterThan(4050);
  });

  it("does not activate before the one-R threshold", () => {
    const result = applyXauPaperPositionCycle(openSellBook(), holdInstruction, input(4057, 2));

    expect(result.open?.trailingActive).toBe(false);
    expect(result.open?.stopPrice).toBe(4076.004878);
  });
});
