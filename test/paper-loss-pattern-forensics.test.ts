import { describe, expect, it } from "vitest";
import { buildPaperLossPatternForensics } from "../src/paper-loss-pattern-forensics";
import type { PaperOperationDossier } from "../src/operation-dossier";

function operation(id: string, pnl: number, complete = true, exitReason = "Stop loss del carril"): PaperOperationDossier {
  return {
    operationId: id,
    strategyId: "fast:XBT/EUR",
    lane: "fast",
    symbol: "XBT/EUR",
    status: "closed",
    entry: {
      tradeId: `buy-${id}`,
      timestamp: 1_000,
      price: 100,
      quantity: 0.05,
      grossEur: 5,
      feeEur: 0.02,
      estimatedSlippageEur: 0.005,
      stopLoss: 98.8,
      takeProfit: 102.4,
      reason: "Cruce EMA alcista con RSI compatible con el carril",
      indicators: null,
      evidencePersisted: complete,
    },
    exit: {
      tradeId: `sell-${id}`,
      linkedEntryTradeId: `buy-${id}`,
      timestamp: 61_000,
      price: pnl > 0 ? 103 : 98,
      grossEur: 5 + pnl,
      feeEur: 0.02,
      estimatedSlippageEur: 0.005,
      reason: exitReason,
      durationMinutes: 1,
      grossPnlBeforeExitFeeEur: pnl + 0.04,
      grossPnlBeforeCostsEur: pnl + 0.05,
      totalCostsEur: 0.05,
      netPnlEur: pnl,
      diagnosis: pnl > 0 ? "winner" : pnl < 0 ? "loser" : "flat",
      economicallySignificant: Math.abs(pnl) >= 0.1,
      evidencePersisted: complete,
    },
    liveTrading: false,
  };
}

describe("PAPER loss-pattern forensics", () => {
  it("marks only sufficiently sampled negative patterns", () => {
    const report = buildPaperLossPatternForensics([
      operation("1", -0.2), operation("2", -0.18), operation("3", -0.22),
      operation("4", -0.19), operation("5", 0.05),
    ], 5);

    expect(report.analyzedClosedOperations).toBe(5);
    expect(report.negativePatterns).toHaveLength(1);
    expect(report.negativePatterns[0]!.sampleSize).toBe(5);
    expect(report.negativePatterns[0]!.netPnlEur).toBeLessThan(0);
    expect(report.negativePatterns[0]!.profitFactor).toBeLessThan(1);
    expect(report.learningMayMutateParameters).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("excludes legacy operations without complete persisted evidence", () => {
    const report = buildPaperLossPatternForensics([
      operation("legacy", -1, false),
      operation("current", -0.1, true),
    ], 1);

    expect(report.analyzedClosedOperations).toBe(1);
    expect(report.excludedLegacyOperations).toBe(1);
    expect(report.patterns).toHaveLength(1);
  });

  it("keeps distinct entry and exit patterns separate", () => {
    const report = buildPaperLossPatternForensics([
      operation("stop", -0.2, true, "Stop loss del carril"),
      operation("time", -0.1, true, "Tiempo máximo de permanencia alcanzado"),
    ], 1);

    expect(report.patterns).toHaveLength(2);
    expect(report.patterns.map((pattern) => pattern.exitReason)).toEqual(expect.arrayContaining([
      "Stop loss del carril",
      "Tiempo máximo de permanencia alcanzado",
    ]));
  });
});
