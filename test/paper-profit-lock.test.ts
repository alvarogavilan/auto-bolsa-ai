import { describe, expect, it } from "vitest";
import { managePaperProfitLock } from "../src/paper-profit-lock";
import type { LabPosition, LabStrategyState } from "../src/research-lab";

const strategy = {
  config: {
    id: "intraday",
    intervalMinutes: 15,
    fastPeriod: 9,
    slowPeriod: 21,
    rsiPeriod: 14,
    buyRsiMinimum: 48,
    buyRsiMaximum: 65,
    sellRsi: 72,
    stopLossPct: 0.02,
    takeProfitPct: 0.08,
    cooldownMinutes: 60,
    maximumHoldingMinutes: 720,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
  },
} as Pick<LabStrategyState, "config">;

function position(): LabPosition {
  return {
    quantity: 10,
    entryPrice: 1,
    entryTime: 1_000,
    costEur: 10.04,
    stopLoss: 0.98,
    takeProfit: 1.08,
  };
}

describe("PAPER profit lock", () => {
  it("does not move the stop before one initial risk unit of favourable movement", () => {
    const trade = position();
    const result = managePaperProfitLock(trade, strategy, 1.015);
    expect(result.activated).toBe(false);
    expect(trade.stopLoss).toBe(0.98);
  });

  it("moves the stop above true break-even and keeps the position open", () => {
    const trade = position();
    const initialTarget = trade.takeProfit;
    const result = managePaperProfitLock(trade, strategy, 1.04);
    expect(result.activated).toBe(true);
    expect(result.trailingActive).toBe(true);
    expect(trade.stopLoss).toBeGreaterThan(1);
    expect(result.protectedNetPnlEur).toBeGreaterThan(0);
    expect(trade.takeProfit).toBeGreaterThanOrEqual(initialTarget);
  });

  it("ratchets the stop upward and never loosens it after a pullback", () => {
    const trade = position();
    managePaperProfitLock(trade, strategy, 1.04);
    const firstStop = trade.stopLoss;
    managePaperProfitLock(trade, strategy, 1.09);
    const secondStop = trade.stopLoss;
    managePaperProfitLock(trade, strategy, 1.06);
    expect(secondStop).toBeGreaterThan(firstStop);
    expect(trade.stopLoss).toBe(secondStop);
  });
});
