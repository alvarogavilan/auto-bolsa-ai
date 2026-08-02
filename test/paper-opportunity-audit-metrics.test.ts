import { describe, expect, it } from "vitest";
import { buildPaperOpportunityDiagnostics } from "../src/paper-opportunity-diagnostics";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";

function strategy(id: string, lastDecision: string, buys = 0, cycles = 1): LabStrategyState {
  return {
    id,
    lane: "fast",
    pairKey: id,
    symbol: `${id}/EUR`,
    base: id,
    status: "active",
    initialCashEur: 100,
    cashEur: 100,
    equityEur: 100,
    peakEquityEur: 100,
    maxDrawdownPct: 0,
    position: null,
    config: { id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7, buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct: 0.012, takeProfitPct: 0.024, cooldownMinutes: 20, maximumHoldingMinutes: 180, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.01,
    lastClosedCandleTime: 1,
    lastAttemptAt: 1,
    lastSuccessfulAt: 1,
    nextDueAt: 2,
    lastTradeAt: null,
    lastDecision,
    cycles,
    uniqueCandles: cycles,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
    trades: [],
  };
}

function state(strategies: LabStrategyState[]): ResearchLabState {
  return { schemaVersion: "multi-horizon-paper-lab-v1", version: "0.17.0-paper", mode: "paper", initializedAt: 1, cohortLockedUntil: 2, sourceUniverseGeneratedAt: 1, lastCycleAt: 1, cycles: 1, strategies, liveTrading: false };
}

describe("PAPER opportunity audit metrics", () => {
  it("exposes the requested rejection families without inventing historical totals", () => {
    const report = buildPaperOpportunityDiagnostics(state([
      strategy("spread", "Compra vetada por spread excesivo", 0, 4),
      strategy("risk", "Carril detenido por drawdown máximo", 0, 3),
      strategy("liquidity", "Compra vetada por profundidad y liquidez", 0, 2),
      strategy("news", "PAPER BUY vetada por noticias", 0, 5),
      strategy("committee", "PAPER BUY vetada por comité", 0, 3),
      strategy("exposure", "PAPER BUY vetada por Tesorería única: exposición máxima", 0, 2),
      strategy("valid", "PAPER BUY autorizada", 2, 6),
    ]), 1);

    expect(report.schemaVersion).toBe("paper-opportunity-diagnostics-v4");
    expect(report.auditMetrics.signalsAnalyzed).toBe(25);
    expect(report.auditMetrics.signalsValid).toBe(2);
    expect(report.auditMetrics.rejectedBySpread).toBe(1);
    expect(report.auditMetrics.rejectedByRisk).toBe(1);
    expect(report.auditMetrics.rejectedByLiquidity).toBe(1);
    expect(report.auditMetrics.rejectedByNews).toBe(1);
    expect(report.auditMetrics.rejectedByCommittee).toBe(1);
    expect(report.auditMetrics.rejectedByExposure).toBe(1);
    expect(report.auditMetrics.operationsOpened).toBe(2);
    expect(report.auditMetrics.currentSnapshotOnly).toBe(true);
    expect(report.auditInterpretation).toContain("no se presentan como un histórico acumulado");
    expect(report.liveTrading).toBe(false);
  });
});
