import { describe, expect, it } from "vitest";
import { calculatePaperReadiness } from "../src/paper-readiness";
import type { BotSnapshot } from "../src/types";

const DAY = 86_400_000;

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    version: "0.10.0-paper",
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
    evidenceStartedAt: 0,
    evidenceMethod: "closed-15m-candles-v1",
    ticksObserved: 0,
    uniqueClosedCandlesObserved: 0,
    duplicateCandleSkips: 0,
    errorsObserved: 0,
    maxObservedDrawdownPct: 0,
    lastClosedCandleTime: null,
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
    performance: {
      buyTrades: 0,
      sellTrades: 0,
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      grossProfitEur: 0,
      grossLossEur: 0,
      netPnlEur: 0,
      totalFeesEur: 0,
    },
    trades: [],
    ...overrides,
  };
}

describe("paper readiness gate", () => {
  it("blocks a new simulator and does not accept duplicate cron calls as evidence", () => {
    const result = calculatePaperReadiness(
      snapshot({ ticksObserved: 500, uniqueClosedCandlesObserved: 100, duplicateCandleSkips: 400 }),
      15 * DAY,
    );
    expect(result.eligibleForLiveReview).toBe(false);
    expect(result.liveTrading).toBe(false);
    expect(result.checks.enoughUniqueClosedCandles).toBe(false);
  });

  it("allows only human review after all conservative closed-candle checks pass", () => {
    const result = calculatePaperReadiness(
      snapshot({
        evidenceStartedAt: 0,
        ticksObserved: 1_500,
        uniqueClosedCandlesObserved: 500,
        duplicateCandleSkips: 1_000,
        errorsObserved: 0,
        performance: {
          buyTrades: 30,
          sellTrades: 30,
          closedTrades: 30,
          winningTrades: 20,
          losingTrades: 10,
          grossProfitEur: 2,
          grossLossEur: 0.5,
          netPnlEur: 1.5,
          totalFeesEur: 2.4,
        },
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

  it("blocks review when error rate or drawdown exceed policy", () => {
    const result = calculatePaperReadiness(
      snapshot({
        evidenceStartedAt: 0,
        ticksObserved: 600,
        uniqueClosedCandlesObserved: 500,
        errorsObserved: 10,
        performance: {
          buyTrades: 30,
          sellTrades: 30,
          closedTrades: 30,
          winningTrades: 30,
          losingTrades: 0,
          grossProfitEur: 3,
          grossLossEur: 0,
          netPnlEur: 3,
          totalFeesEur: 2.4,
        },
        equityEur: 53,
        peakEquityEur: 54,
        maxObservedDrawdownPct: 0.06,
      }),
      20 * DAY,
    );

    expect(result.errorRatePct).toBeGreaterThan(1);
    expect(result.checks.errorRateAccepted).toBe(false);
    expect(result.checks.drawdownAccepted).toBe(false);
    expect(result.eligibleForLiveReview).toBe(false);
  });
});
