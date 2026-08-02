import { describe, expect, it } from "vitest";
import {
  advancePaperOpportunityAuditLedger,
  emptyPaperOpportunityAuditLedger,
  sanitizePaperOpportunityAuditLedger,
} from "../src/paper-opportunity-audit-ledger";
import type { LabStrategyState } from "../src/research-lab";

function strategy(decision: string, lastAttemptAt = 100): LabStrategyState {
  return {
    id: "fast:XBT/EUR",
    lane: "fast",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
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
    lastAttemptAt,
    lastSuccessfulAt: lastAttemptAt,
    nextDueAt: lastAttemptAt + 1,
    lastTradeAt: null,
    lastDecision: decision,
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: 0, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
    trades: [],
  };
}

describe("persistent negative PAPER pattern audit", () => {
  it("classifies the statistical veto separately from risk, exposure and recovery", () => {
    const result = advancePaperOpportunityAuditLedger(
      emptyPaperOpportunityAuditLedger(1),
      [strategy("PAPER BUY vetada por patrón negativo con evidencia suficiente: 5 cierres del mismo carril, activo y motivo de entrada")],
      100,
      101,
    );

    expect(result.schemaVersion).toBe("paper-opportunity-audit-ledger-v4");
    expect(result.rejectedByNegativePattern).toBe(1);
    expect(result.rejectedByEarlyLossStreak).toBe(0);
    expect(result.rejectedByRisk).toBe(0);
    expect(result.rejectedByExposure).toBe(0);
    expect(result.rejectedByLossRecovery).toBe(0);
    expect(result.rejectedOther).toBe(0);
    expect(result.liveTrading).toBe(false);
  });

  it("classifies the early three-loss brake separately from the statistical veto", () => {
    const result = advancePaperOpportunityAuditLedger(
      emptyPaperOpportunityAuditLedger(1),
      [strategy("PAPER BUY vetada por racha temprana del patrón: 3 pérdidas consecutivas del mismo carril, activo y motivo de entrada")],
      100,
      101,
    );

    expect(result.rejectedByEarlyLossStreak).toBe(1);
    expect(result.rejectedByNegativePattern).toBe(0);
    expect(result.rejectedByRisk).toBe(0);
    expect(result.rejectedByExposure).toBe(0);
    expect(result.rejectedByLossRecovery).toBe(0);
    expect(result.rejectedOther).toBe(0);
  });

  it("migrates prior ledgers without inventing historical vetoes", () => {
    const migrated = sanitizePaperOpportunityAuditLedger({
      schemaVersion: "paper-opportunity-audit-ledger-v3",
      rejectedByLossRecovery: 4,
      cyclesObserved: 9,
    }, 10);

    expect(migrated.schemaVersion).toBe("paper-opportunity-audit-ledger-v4");
    expect(migrated.rejectedByLossRecovery).toBe(4);
    expect(migrated.rejectedByEarlyLossStreak).toBe(0);
    expect(migrated.rejectedByNegativePattern).toBe(0);
    expect(migrated.cyclesObserved).toBe(9);
  });
});
