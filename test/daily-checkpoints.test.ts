import { describe, expect, it } from "vitest";
import {
  createDailyCheckpoint,
  verifyCheckpointChain,
  type PaperDailyCheckpoint,
} from "../src/daily-checkpoints";
import type { BotSnapshot } from "../src/types";

function snapshot(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    version: "0.12.0-paper",
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
    ticksObserved: 20,
    uniqueClosedCandlesObserved: 7,
    duplicateCandleSkips: 13,
    errorsObserved: 0,
    consecutiveErrors: 0,
    lastError: null,
    maxObservedDrawdownPct: 0,
    lastClosedCandleTime: 1_785_500_100,
    lastPrice: 54_000,
    lastTickAt: 1_785_500_200_000,
    lastSuccessfulTickAt: 1_785_500_200_000,
    lastTradeAt: null,
    lastDecision: "Sin señal válida",
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

describe("daily PAPER checkpoint chain", () => {
  it("creates an ordered SHA-256 chain without enabling live trading", async () => {
    const first = await createDailyCheckpoint(snapshot(), null, 1_785_542_400_000);
    const second = await createDailyCheckpoint(
      snapshot({ dayKey: "2026-08-01", equityEur: 50.2, cashEur: 50.2 }),
      first,
      1_785_628_800_000,
    );

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBeNull();
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);

    const verification = await verifyCheckpointChain([first, second]);
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBe(2);
    expect(verification.latestHash).toBe(second.hash);
  });

  it("detects any modification to historical evidence", async () => {
    const first = await createDailyCheckpoint(snapshot(), null, 1_785_542_400_000);
    const tampered: PaperDailyCheckpoint = {
      ...first,
      metrics: { ...first.metrics, equityEur: 999 },
    };

    const verification = await verifyCheckpointChain([tampered]);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtSequence).toBe(1);
  });
});
