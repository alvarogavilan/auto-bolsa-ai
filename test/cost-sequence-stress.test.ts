import { describe, expect, it } from "vitest";
import { buildCostSequenceStressReport } from "../src/cost-sequence-stress";
import { LAB_LANE_CONFIGS, type LabStrategyState } from "../src/research-lab";

const START = 1_800_000_000_000;

function strategy(pnls: number[], id = "intraday:XXBTZEUR"): LabStrategyState {
  const trades: LabStrategyState["trades"] = [];
  pnls.forEach((pnl, index) => {
    trades.push({
      id: `buy-${index}`,
      side: "buy",
      timestamp: START + index * 120_000,
      price: 100,
      quantity: 0.1,
      grossEur: 10,
      feeEur: 0.04,
      reason: "Stress fixture entry",
    });
    trades.push({
      id: `sell-${index}`,
      side: "sell",
      timestamp: START + index * 120_000 + 60_000,
      price: 100,
      quantity: 0.1,
      grossEur: 10,
      feeEur: 0.04,
      reason: "Stress fixture exit",
      pnlEur: pnl,
    });
  });
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
    peakEquityEur: 55,
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
    cycles: 400,
    uniqueCandles: 320,
    duplicateSkips: 80,
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
    trades,
  };
}

describe("cost and sequence stress", () => {
  it("keeps fewer than thirty round trips as insufficient", () => {
    const entry = buildCostSequenceStressReport([strategy(Array.from({ length: 10 }, () => 0.2))]).entries[0]!;

    expect(entry.closedRoundTrips).toBe(10);
    expect(entry.verdict).toBe("insufficient");
    expect(entry.blockers.join(" ")).toContain("30");
    expect(entry.changesTradingDecision).toBe(false);
    expect(entry.liveTrading).toBe(false);
  });

  it("makes every adverse scenario no better than observed PnL", () => {
    const entry = buildCostSequenceStressReport([strategy(Array.from({ length: 30 }, () => 0.2))]).entries[0]!;
    const observed = entry.observedScenario.netPnlEur;

    expect(entry.scenarios.find((item) => item.id === "fees_25")!.netPnlEur).toBeLessThan(observed);
    expect(entry.scenarios.find((item) => item.id === "fees_50")!.netPnlEur).toBeLessThan(observed);
    expect(entry.scenarios.find((item) => item.id === "fees_100")!.netPnlEur).toBeLessThan(observed);
    expect(entry.scenarios.find((item) => item.id === "adverse_fill")!.netPnlEur).toBeLessThan(observed);
    expect(entry.combinedScenario.netPnlEur).toBeLessThan(observed);
  });

  it("marks an edge as fragile when realistic adverse costs remove it", () => {
    const entry = buildCostSequenceStressReport([strategy(Array.from({ length: 40 }, () => 0.04))]).entries[0]!;

    expect(entry.observedScenario.netPnlEur).toBeGreaterThan(0);
    expect(entry.combinedScenario.netPnlEur).toBeLessThanOrEqual(0);
    expect(entry.verdict).toBe("fragile");
    expect(entry.blockers.join(" ")).toContain("escenario combinado");
  });

  it("recognizes a broad sample that survives the combined scenario", () => {
    const pnls = Array.from({ length: 60 }, (_, index) => index % 4 === 0 ? -0.05 : 0.2);
    const entry = buildCostSequenceStressReport([strategy(pnls)]).entries[0]!;

    expect(entry.combinedScenario.netPnlEur).toBeGreaterThan(0);
    expect(entry.combinedScenario.profitFactor).toBeGreaterThan(1.1);
    expect(entry.combinedScenario.maxDrawdownPct).toBeLessThanOrEqual(0.05);
    expect(entry.verdict).toBe("resilient_candidate");
  });

  it("measures losing streaks and the worst five-trade window chronologically", () => {
    const pnls = [
      ...Array.from({ length: 10 }, () => 0.2),
      ...Array.from({ length: 6 }, () => -0.2),
      ...Array.from({ length: 24 }, () => 0.2),
    ];
    const entry = buildCostSequenceStressReport([strategy(pnls)]).entries[0]!;

    expect(entry.combinedScenario.longestLosingStreak).toBeGreaterThanOrEqual(6);
    expect(entry.combinedScenario.worstFiveTradePnlEur).toBeLessThan(0);
    expect(entry.verdict).toBe("fragile");
    expect(entry.blockers.join(" ")).toContain("seis pérdidas");
  });

  it("ranks resilient evidence above fragile and insufficient strategies", () => {
    const resilient = strategy(Array.from({ length: 60 }, (_, index) => index % 4 === 0 ? -0.05 : 0.2), "resilient");
    const fragile = strategy(Array.from({ length: 40 }, () => 0.04), "fragile");
    const insufficient = strategy(Array.from({ length: 8 }, () => 0.2), "insufficient");
    const report = buildCostSequenceStressReport([insufficient, fragile, resilient]);

    expect(report.leaderboard.map((entry) => entry.strategyId)).toEqual(["resilient", "fragile", "insufficient"]);
    expect(report.resilientCandidates).toBe(1);
    expect(report.fragileStrategies).toBe(1);
    expect(report.insufficientStrategies).toBe(1);
    expect(report.eligibleForLiveReview).toBe(false);
  });
});
