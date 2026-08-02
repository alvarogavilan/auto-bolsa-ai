import { describe, expect, it } from "vitest";
import {
  advancePaperOpportunityAuditLedger,
  buildPaperOpportunityAuditLedgerReport,
  emptyPaperOpportunityAuditLedger,
} from "../src/paper-opportunity-audit-ledger";
import type { LabStrategyState } from "../src/research-lab";

function strategy(id: string, decision: string, lastAttemptAt: number, buyIds: string[] = []): LabStrategyState {
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
    lastAttemptAt,
    lastSuccessfulAt: lastAttemptAt,
    nextDueAt: lastAttemptAt + 1,
    lastTradeAt: buyIds.length ? lastAttemptAt : null,
    lastDecision: decision,
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: buyIds.length, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
    trades: buyIds.map((tradeId) => ({ id: tradeId, side: "buy" as const, timestamp: lastAttemptAt, price: 1, quantity: 5, grossEur: 5, feeEur: 0.02, reason: decision })),
  };
}

describe("persistent PAPER opportunity audit ledger", () => {
  it("accumulates processed signals and rejection reasons across cycles", () => {
    const first = advancePaperOpportunityAuditLedger(
      emptyPaperOpportunityAuditLedger(1),
      [
        strategy("spread", "Compra vetada por spread excesivo", 10),
        strategy("news", "PAPER BUY vetada por noticias", 10),
        strategy("valid", "PAPER BUY autorizada", 10, ["buy-1"]),
      ],
      10,
      11,
    );
    expect(first.cyclesObserved).toBe(1);
    expect(first.signalsAnalyzed).toBe(3);
    expect(first.signalsValid).toBe(1);
    expect(first.operationsOpened).toBe(1);
    expect(first.rejectedBySpread).toBe(1);
    expect(first.rejectedByNews).toBe(1);

    const second = advancePaperOpportunityAuditLedger(
      first,
      [
        strategy("risk", "Carril detenido por drawdown máximo", 20),
        strategy("same-buy", "PAPER BUY autorizada", 20, ["buy-1"]),
        strategy("exposure", "PAPER BUY vetada por Tesorería única: exposición máxima", 20),
      ],
      20,
      21,
    );
    expect(second.cyclesObserved).toBe(2);
    expect(second.signalsAnalyzed).toBe(6);
    expect(second.signalsValid).toBe(1);
    expect(second.operationsOpened).toBe(1);
    expect(second.rejectedByRisk).toBe(1);
    expect(second.rejectedByExposure).toBe(1);
    expect(second.rejectedOther).toBe(1);
  });

  it("does not count an already-open position as a rejected opportunity", () => {
    const open = strategy("open", "Continuación PAPER descartada: posición ya abierta", 30, ["buy-open"]);
    open.position = { quantity: 5, entryPrice: 1, entryTime: 20, costEur: 5.02, stopLoss: 0.98, takeProfit: 1.04 };
    const seeded = advancePaperOpportunityAuditLedger(emptyPaperOpportunityAuditLedger(1), [open], 20, 21);
    const next = advancePaperOpportunityAuditLedger(seeded, [open], 30, 31);
    expect(next.skippedPositionAlreadyOpen).toBe(1);
    expect(next.rejectedOther).toBe(0);
    expect(next.operationsOpened).toBe(1);
  });

  it("publishes no private trade ids and never changes trading decisions", () => {
    const state = advancePaperOpportunityAuditLedger(
      emptyPaperOpportunityAuditLedger(1),
      [strategy("valid", "PAPER BUY autorizada", 10, ["private-buy-id"])],
      10,
      11,
    );
    const report = buildPaperOpportunityAuditLedgerReport(state);
    expect(report.uniqueBuyIdsRetained).toBe(1);
    expect("seenBuyTradeIds" in report).toBe(false);
    expect(report.historical).toBe(true);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.liveTrading).toBe(false);
  });
});
