import { describe, expect, it } from "vitest";
import { calculatePaperExitEconomics, projectedNetPnlAtRawPrice } from "../src/paper-net-exit";
import type { LabPosition, LabStrategyState } from "../src/research-lab";

const strategy = {
  config: {
    id: "fast",
    intervalMinutes: 5,
    fastPeriod: 5,
    slowPeriod: 13,
    rsiPeriod: 7,
    buyRsiMinimum: 46,
    buyRsiMaximum: 62,
    sellRsi: 68,
    stopLossPct: 0.012,
    takeProfitPct: 0.024,
    cooldownMinutes: 20,
    maximumHoldingMinutes: 180,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
  },
} as Pick<LabStrategyState, "config">;

function position(): LabPosition {
  const entryPrice = 1.001;
  const gross = 5;
  const fee = gross * strategy.config.feePctEachSide;
  return {
    quantity: gross / entryPrice,
    entryPrice,
    entryTime: 1_000,
    costEur: gross + fee,
    stopLoss: entryPrice * (1 - strategy.config.stopLossPct),
    takeProfit: entryPrice * (1 + strategy.config.takeProfitPct),
  };
}

describe("PAPER net exit economics", () => {
  it("places take profit above the old gross trigger so the target is net after all costs", () => {
    const trade = position();
    const economics = calculatePaperExitEconomics(trade, strategy);
    const oldGrossTrigger = trade.entryPrice * (1 + strategy.config.takeProfitPct);

    expect(economics.rawTriggerPrice).toBeGreaterThan(oldGrossTrigger);
    expect(economics.breakEvenRawPrice).toBeGreaterThan(trade.entryPrice);
    expect(economics.projectedNetPnlEur).toBeCloseTo(trade.costEur * strategy.config.takeProfitPct, 5);
    expect(projectedNetPnlAtRawPrice(trade, strategy, economics.rawTriggerPrice)).toBeCloseTo(economics.projectedNetPnlEur, 5);
  });

  it("shows that a small gross rise can still be negative after entry and exit costs", () => {
    const trade = position();
    const smallGrossRise = trade.entryPrice * 1.004;
    expect(projectedNetPnlAtRawPrice(trade, strategy, smallGrossRise)).toBeLessThan(0);
  });

  it("calculates a true break-even raw price", () => {
    const trade = position();
    const economics = calculatePaperExitEconomics(trade, strategy, 0);
    expect(projectedNetPnlAtRawPrice(trade, strategy, economics.breakEvenRawPrice)).toBeCloseTo(0, 5);
  });
});
