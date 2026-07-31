import { describe, expect, it } from "vitest";
import { calculatePaperReadiness } from "../src/paper-readiness";
import type { BotSnapshot, PaperTrade } from "../src/types";

const DAY = 86_400_000;

function trade(index: number, pnlEur: number): PaperTrade {
  return {
    id: String(index),
    side: "sell",
    price: 50_000,
    quantity: 0.0002,
    grossEur: 10,
    feeEur: 0.04,
    timestamp: index,
    reason: "test",
    pnlEur,
  };
}

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    version: "0.9.0-paper",
    mode: "paper",
    paused: false,
    initialCashEur: 50,
    cashEur: 50,
    position: null,
    equityEur: 50,
    peakEquityEur: 50,
    dayStartEquityEur: 50,
    dayKey: "2026-07-31",
    paperStartedAt: 0,
    ticksObserved: 0,
    errorsObserved: 0,
    maxObservedDrawdownPct: 0,
    lastPrice: null,
    lastTickAt: null,
    lastTradeAt: null,
    lastDecision: "test",
    config: {
      pair: "XBTEUR",
      fastPeriod: 9,
      slowPeriod: 21,
      rsiPeriod: 14,
      maxExposurePct: 0.2,
      maxDailyLossPct: 0.01,
      maxDrawdownPct: 0.05,
      stopLossPct: 0.02,
      takeProfitPct: 0.03,
      cooldownMinutes: 60,
      feePct: 0.004,
      slippagePct: 0.001,
    },
    trades: [],
    ...overrides,
  };
}

describe("paper readiness gate", () => {
  it("blocks a new simulator even when credentials are safe", () => {
    const result = calculatePaperReadiness(snapshot(), DAY);
    expect(result.eligibleForLiveReview).toBe(false);
    expect(result.liveTrading).toBe(false);
    expect(result.checks.enoughClosedTrades).toBe(false);
  });

  it("allows only human review after all conservative PAPER checks pass", () => {
    const trades = [
      ...Array.from({ length: 20 }, (_, index) => trade(index, 0.1)),
      ...Array.from({ length: 10 }, (_, index) => trade(index + 20, -0.05)),
    ];
    const result = calculatePaperReadiness(
      snapshot({
        paperStartedAt: 0,
        ticksObserved: 500,
        errorsObserved: 0,
        trades,
        equityEur: 51.5,
        peakEquityEur: 52,
        maxObservedDrawdownPct: 0.02,
      }),
      15 * DAY,
    );

    expect(result.closedTrades).toBe(30);
    expect(result.netPnlEur).toBe(1.5);
    expect(result.profitFactor).toBe(4);
    expect(result.eligibleForLiveReview).toBe(true);
    expect(result.liveTrading).toBe(false);
  });

  it("blocks review when runtime errors or drawdown exceed policy", () => {
    const result = calculatePaperReadiness(
      snapshot({
        paperStartedAt: 0,
        ticksObserved: 600,
        errorsObserved: 10,
        trades: Array.from({ length: 30 }, (_, index) => trade(index, 0.1)),
        equityEur: 53,
        peakEquityEur: 54,
        maxObservedDrawdownPct: 0.06,
      }),
      20 * DAY,
    );

    expect(result.errorRatePct).toBeGreaterThan(1);
    expect(result.checks.runtimeErrorsAccepted).toBe(false);
    expect(result.checks.drawdownAccepted).toBe(false);
    expect(result.eligibleForLiveReview).toBe(false);
  });
});
