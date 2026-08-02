import { describe, expect, it } from "vitest";
import { buildOperationDossiers } from "../src/operation-dossier";
import { captureTradeIds, enrichNewPaperTrades, type EvidencedLabTrade } from "../src/paper-trade-evidence-enrichment";
import type { LabStrategyState } from "../src/research-lab";
import type { Candle } from "../src/types";

function strategy(): LabStrategyState {
  return {
    id: "swing:XBT/EUR", lane: "swing", pairKey: "XXBTZEUR", symbol: "XBT/EUR", base: "XBT", status: "active",
    initialCashEur: 100, cashEur: 90, equityEur: 100, peakEquityEur: 100, maxDrawdownPct: 0,
    position: null,
    config: { id: "swing", intervalMinutes: 60, fastPeriod: 3, slowPeriod: 5, rsiPeriod: 3, buyRsiMinimum: 45, buyRsiMaximum: 68, sellRsi: 75, stopLossPct: 0.04, takeProfitPct: 0.08, cooldownMinutes: 360, maximumHoldingMinutes: 20160, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 5, estimatedTakerRoundTripCostPct: 0.01,
    lastClosedCandleTime: 1, lastAttemptAt: 1, lastSuccessfulAt: 1, nextDueAt: 2, lastTradeAt: 1,
    lastDecision: "test", cycles: 1, uniqueCandles: 1, duplicateSkips: 0, errors: 0, consecutiveErrors: 0, lastError: null,
    performance: { buys: 1, sells: 1, closedTrades: 1, winningTrades: 1, losingTrades: 0, grossProfitEur: 0.5, grossLossEur: 0, netPnlEur: 0.5, totalFeesEur: 0.08 },
    trades: [],
  };
}

const candles: Candle[] = Array.from({ length: 8 }, (_, index) => ({
  time: index + 1,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 10,
}));

describe("persisted PAPER trade evidence", () => {
  it("stores entry indicators, costs, stop and target", () => {
    const value = strategy();
    const before = captureTradeIds(value);
    value.trades = [{ id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "Cruce confirmado" }];

    expect(enrichNewPaperTrades(value, candles, before)).toBe(1);
    const trade = value.trades[0] as EvidencedLabTrade;
    expect(trade.evidenceVersion).toBe("paper-trade-evidence-v1");
    expect(trade.indicators).not.toBeNull();
    expect(trade.stopLoss).toBe(96);
    expect(trade.takeProfit).toBe(108);
    expect(trade.estimatedSlippageEur).toBe(0.01);
    expect(trade.learningMayMutateParameters).toBe(false);
    expect(trade.liveTrading).toBe(false);
  });

  it("links a close to its entry and exposes gross, costs, net and duration", () => {
    const value = strategy();
    value.trades = [{ id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "Entrada" }];
    enrichNewPaperTrades(value, candles, new Set());
    const beforeClose = captureTradeIds(value);
    value.trades.push({ id: "sell-1", side: "sell", timestamp: 121_000, price: 106, quantity: 0.1, grossEur: 10.6, feeEur: 0.0424, reason: "Objetivo", pnlEur: 0.5176 });

    enrichNewPaperTrades(value, candles, beforeClose);
    const report = buildOperationDossiers([value], 200_000);
    expect(report.operations).toHaveLength(1);
    const operation = report.operations[0]!;
    expect(operation.exit?.linkedEntryTradeId).toBe("buy-1");
    expect(operation.exit?.durationMinutes).toBe(2);
    expect(operation.exit?.grossPnlBeforeCostsEur).toBeGreaterThan(operation.exit?.netPnlEur ?? 0);
    expect(operation.exit?.totalCostsEur).toBeGreaterThan(0);
    expect(operation.entry.indicators).not.toBeNull();
    expect(report.evidenceCoveragePct).toBe(100);
    expect(report.learningMayMutateParameters).toBe(false);
    expect(report.liveTrading).toBe(false);
  });
});
