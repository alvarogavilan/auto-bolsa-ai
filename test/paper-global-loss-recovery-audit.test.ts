import { describe, expect, it } from "vitest";
import {
  advancePaperOpportunityAuditLedger,
  emptyPaperOpportunityAuditLedger,
} from "../src/paper-opportunity-audit-ledger";
import { buildPaperOpportunityDiagnostics } from "../src/paper-opportunity-diagnostics";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";

function strategy(id: string, pnlEur: number, timestamp: number, lastDecision: string, lastAttemptAt = 100): LabStrategyState {
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
    lastClosedCandleTime: timestamp,
    lastAttemptAt,
    lastSuccessfulAt: timestamp,
    nextDueAt: timestamp + 1,
    lastTradeAt: timestamp,
    lastDecision,
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: 1, sells: 1, closedTrades: 1, winningTrades: pnlEur > 0 ? 1 : 0, losingTrades: pnlEur < 0 ? 1 : 0, grossProfitEur: Math.max(0, pnlEur), grossLossEur: Math.min(0, pnlEur), netPnlEur: pnlEur, totalFeesEur: 0.04 },
    trades: [{ id: `sell-${id}`, side: "sell", timestamp, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "cierre", pnlEur }],
  };
}

function state(strategies: LabStrategyState[]): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: 1,
    cohortLockedUntil: 2,
    sourceUniverseGeneratedAt: 1,
    lastCycleAt: 100,
    cycles: 1,
    strategies,
    liveTrading: false,
  };
}

describe("global PAPER loss recovery audit", () => {
  it("exposes the global streak and separates the current veto from exposure", () => {
    const report = buildPaperOpportunityDiagnostics(state([
      strategy("a", -0.1, 30, "PAPER BUY vetada por freno global de Tesorería tras 3 pérdidas consecutivas de cartera"),
      strategy("b", -0.2, 20, "Sin señal válida para el carril"),
      strategy("c", -0.3, 10, "Sin señal válida para el carril"),
    ]), 100);

    expect(report.schemaVersion).toBe("paper-opportunity-diagnostics-v5");
    expect(report.globalLossRecovery.currentLosingStreak).toBe(3);
    expect(report.globalLossRecovery.activationThreshold).toBe(3);
    expect(report.globalLossRecovery.active).toBe(true);
    expect(report.globalLossRecovery.blocksNewEntries).toBe(true);
    expect(report.globalLossRecovery.safetyExitsRemainAllowed).toBe(true);
    expect(report.auditMetrics.rejectedByLossRecovery).toBe(1);
    expect(report.auditMetrics.rejectedByExposure).toBe(0);
    expect(report.liveTrading).toBe(false);
  });

  it("persists each recovery veto once per observed cycle", () => {
    const strategies = [strategy("a", -0.1, 30, "PAPER BUY vetada por freno global de Tesorería tras 3 pérdidas consecutivas de cartera")];
    const first = advancePaperOpportunityAuditLedger(emptyPaperOpportunityAuditLedger(1), strategies, 100, 101);
    expect(first.schemaVersion).toBe("paper-opportunity-audit-ledger-v4");
    expect(first.rejectedByLossRecovery).toBe(1);
    expect(first.rejectedByExposure).toBe(0);

    const unchanged = advancePaperOpportunityAuditLedger(first, strategies, null, 102);
    expect(unchanged.rejectedByLossRecovery).toBe(1);
    expect(unchanged.cyclesObserved).toBe(1);
  });
});
