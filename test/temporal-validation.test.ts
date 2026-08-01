import { describe, expect, it } from "vitest";
import { LAB_LANE_CONFIGS, type LabStrategyState } from "../src/research-lab";
import { buildTemporalValidationReport } from "../src/temporal-validation";

const START = 1_800_000_000_000;

function sellTrade(index: number, pnlEur: number): LabStrategyState["trades"][number] {
  return {
    id: `sell-${index}`,
    side: "sell",
    timestamp: START + index * 60_000,
    price: 100 + index,
    quantity: 0.1,
    grossEur: 10,
    feeEur: 0.04,
    reason: "Temporal validation fixture",
    pnlEur,
  };
}

function strategy(pnls: number[], id = "intraday:XXBTZEUR"): LabStrategyState {
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  return {
    id,
    lane: "intraday",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 50 + pnls.reduce((sum, value) => sum + value, 0),
    equityEur: 50 + pnls.reduce((sum, value) => sum + value, 0),
    peakEquityEur: 52,
    maxDrawdownPct: 0.02,
    position: null,
    config: LAB_LANE_CONFIGS.intraday,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: 1_700_000_000,
    lastAttemptAt: START,
    lastSuccessfulAt: START,
    nextDueAt: START + 60_000,
    lastTradeAt: START,
    lastDecision: "Sin señal válida",
    cycles: 300,
    uniqueCandles: 250,
    duplicateSkips: 50,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: pnls.length,
      sells: pnls.length,
      closedTrades: pnls.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      grossProfitEur: wins.reduce((sum, value) => sum + value, 0),
      grossLossEur: losses.reduce((sum, value) => sum + Math.abs(value), 0),
      netPnlEur: pnls.reduce((sum, value) => sum + value, 0),
      totalFeesEur: pnls.length * 0.08,
    },
    trades: pnls.map((pnl, index) => sellTrade(index, pnl)),
  };
}

describe("temporal out-of-sample validation", () => {
  it("keeps fewer than thirty closed trades as insufficient", () => {
    const report = buildTemporalValidationReport([strategy(Array.from({ length: 12 }, () => 0.05))]);
    const entry = report.entries[0]!;

    expect(entry.verdict).toBe("insufficient");
    expect(entry.totalClosedTrades).toBe(12);
    expect(entry.blockers.join(" ")).toContain("30");
    expect(report.sufficientlySampledStrategies).toBe(0);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("recognizes a stable strategy across initial, posterior and rolling blocks", () => {
    const pnls = Array.from({ length: 60 }, (_, index) => index % 3 === 0 ? -0.04 : 0.08);
    const report = buildTemporalValidationReport([strategy(pnls)]);
    const entry = report.entries[0]!;

    expect(entry.training.trades).toBe(36);
    expect(entry.validation.trades).toBe(24);
    expect(entry.training.netPnlEur).toBeGreaterThan(0);
    expect(entry.validation.netPnlEur).toBeGreaterThan(0);
    expect(entry.positiveRollingFolds).toBe(3);
    expect(entry.verdict).toBe("robust_candidate");
    expect(entry.stabilityScore).toBeGreaterThanOrEqual(80);
    expect(entry.changesTradingDecision).toBe(false);
  });

  it("detects degradation when the posterior period loses money", () => {
    const pnls = [
      ...Array.from({ length: 36 }, (_, index) => index % 4 === 0 ? -0.02 : 0.08),
      ...Array.from({ length: 24 }, (_, index) => index % 4 === 0 ? 0.02 : -0.06),
    ];
    const entry = buildTemporalValidationReport([strategy(pnls)]).entries[0]!;

    expect(entry.training.netPnlEur).toBeGreaterThan(0);
    expect(entry.validation.netPnlEur).toBeLessThan(0);
    expect(entry.verdict).toBe("unstable");
    expect(entry.blockers).toContain("El tramo posterior fuera de muestra no es rentable.");
  });

  it("rejects a posterior result dominated by one lucky trade", () => {
    const training = Array.from({ length: 36 }, (_, index) => index % 3 === 0 ? -0.03 : 0.07);
    const validation = [1.5, ...Array.from({ length: 23 }, () => -0.02)];
    const entry = buildTemporalValidationReport([strategy([...training, ...validation])]).entries[0]!;

    expect(entry.validation.netPnlEur).toBeGreaterThan(0);
    expect(entry.validation.positivePnlConcentrationPct).toBe(100);
    expect(entry.verdict).toBe("unstable");
    expect(entry.blockers.join(" ")).toContain("una sola operación");
  });

  it("orders robust evidence above unstable and insufficient strategies", () => {
    const robust = strategy(Array.from({ length: 60 }, (_, index) => index % 3 === 0 ? -0.04 : 0.08), "robust");
    const unstable = strategy([
      ...Array.from({ length: 36 }, () => 0.05),
      ...Array.from({ length: 24 }, () => -0.04),
    ], "unstable");
    const insufficient = strategy(Array.from({ length: 10 }, () => 0.05), "insufficient");
    const report = buildTemporalValidationReport([insufficient, unstable, robust]);

    expect(report.leaderboard.map((entry) => entry.strategyId)).toEqual(["robust", "unstable", "insufficient"]);
    expect(report.robustCandidates).toBe(1);
    expect(report.unstableStrategies).toBe(1);
    expect(report.insufficientStrategies).toBe(1);
  });
});
