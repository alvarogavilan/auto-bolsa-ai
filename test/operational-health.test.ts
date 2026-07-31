import { describe, expect, it } from "vitest";
import { calculateOperationalHealth } from "../src/operational-health";
import type { BotSnapshot } from "../src/types";

const MINUTE = 60_000;

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    version: "0.11.0-paper",
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
    ticksObserved: 10,
    uniqueClosedCandlesObserved: 4,
    duplicateCandleSkips: 6,
    errorsObserved: 0,
    consecutiveErrors: 0,
    lastError: null,
    maxObservedDrawdownPct: 0,
    lastClosedCandleTime: null,
    lastPrice: 50_000,
    lastTickAt: null,
    lastSuccessfulTickAt: null,
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

describe("operational supervisor", () => {
  const now = 2_000_000_000_000;

  it("reports initializing before the first successful cycle", () => {
    expect(calculateOperationalHealth(snapshot(), now).status).toBe("initializing");
  });

  it("reports healthy when cron, data and errors are within policy", () => {
    const health = calculateOperationalHealth(
      snapshot({
        lastTickAt: now - 5 * MINUTE,
        lastSuccessfulTickAt: now - 5 * MINUTE,
        lastClosedCandleTime: Math.floor((now - 15 * MINUTE) / 1000),
      }),
      now,
    );
    expect(health.status).toBe("healthy");
    expect(health.cronHealthy).toBe(true);
    expect(health.marketDataFresh).toBe(true);
  });

  it("reports stale when no successful cron cycle arrives in twelve minutes", () => {
    const health = calculateOperationalHealth(
      snapshot({
        lastTickAt: now - 2 * MINUTE,
        lastSuccessfulTickAt: now - 13 * MINUTE,
        lastClosedCandleTime: Math.floor((now - 15 * MINUTE) / 1000),
      }),
      now,
    );
    expect(health.status).toBe("stale");
    expect(health.cronHealthy).toBe(false);
  });

  it("reports degraded after repeated errors even when the cron is recent", () => {
    const health = calculateOperationalHealth(
      snapshot({
        ticksObserved: 100,
        errorsObserved: 3,
        consecutiveErrors: 3,
        lastError: "Kraken OHLC HTTP 503",
        lastTickAt: now - MINUTE,
        lastSuccessfulTickAt: now - 5 * MINUTE,
        lastClosedCandleTime: Math.floor((now - 15 * MINUTE) / 1000),
      }),
      now,
    );
    expect(health.status).toBe("degraded");
    expect(health.errorRateAccepted).toBe(false);
  });

  it("prioritizes an explicit pause", () => {
    const health = calculateOperationalHealth(snapshot({ paused: true }), now);
    expect(health.status).toBe("paused");
  });
});
