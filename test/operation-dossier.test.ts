import { describe, expect, it } from "vitest";
import { buildOperationDossiers } from "../src/operation-dossier";
import type { LabStrategyState, LabTrade } from "../src/research-lab";

function strategyWithTrades(trades: LabTrade[]): LabStrategyState {
  return {
    id: "fast:XBT/EUR",
    lane: "fast",
    pairKey: "XBT/EUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 50,
    equityEur: 50,
    peakEquityEur: 50,
    maxDrawdownPct: 0,
    position: null,
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
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.01,
    lastClosedCandleTime: 1,
    lastAttemptAt: 1,
    lastSuccessfulAt: 1,
    nextDueAt: 2,
    lastTradeAt: 1,
    lastDecision: "test",
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: trades.filter((trade) => trade.side === "buy").length,
      sells: trades.filter((trade) => trade.side === "sell").length,
      closedTrades: trades.filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number").length,
      winningTrades: trades.filter((trade) => (trade.pnlEur ?? 0) > 0).length,
      losingTrades: trades.filter((trade) => (trade.pnlEur ?? 0) < 0).length,
      grossProfitEur: 0,
      grossLossEur: 0,
      netPnlEur: 0,
      totalFeesEur: 0,
    },
    trades,
  };
}

describe("paper operation dossiers", () => {
  it("pairs buys and sells chronologically and counts one result per closed operation", () => {
    const report = buildOperationDossiers([strategyWithTrades([
      { id: "sell-2", side: "sell", timestamp: 400_000, price: 106, quantity: 0.1, grossEur: 10.6, feeEur: 0.0424, reason: "take profit", pnlEur: 0.45 },
      { id: "buy-2", side: "buy", timestamp: 300_000, price: 101, quantity: 0.1, grossEur: 10.1, feeEur: 0.0404, reason: "entrada 2" },
      { id: "sell-1", side: "sell", timestamp: 200_000, price: 99, quantity: 0.1, grossEur: 9.9, feeEur: 0.0396, reason: "stop", pnlEur: -0.18 },
      { id: "buy-1", side: "buy", timestamp: 100_000, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "entrada 1" },
    ])], 999_000);

    expect(report.closed).toBe(2);
    expect(report.open).toBe(0);
    expect(report.significantWins).toBe(1);
    expect(report.losses).toBe(1);
    expect(report.operations.find((operation) => operation.entry.tradeId === "buy-1")?.exit?.tradeId).toBe("sell-1");
    expect(report.operations.find((operation) => operation.entry.tradeId === "buy-2")?.exit?.tradeId).toBe("sell-2");
    expect(report.sourceOfTruth).toBe("state.strategies[].trades");
    expect(report.learningMayMutateParameters).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("keeps unmatched buys open and ignores orphan sells instead of inventing an entry", () => {
    const report = buildOperationDossiers([strategyWithTrades([
      { id: "orphan-sell", side: "sell", timestamp: 50_000, price: 90, quantity: 0.1, grossEur: 9, feeEur: 0.036, reason: "legacy", pnlEur: -1 },
      { id: "open-buy", side: "buy", timestamp: 100_000, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "entrada abierta" },
    ])], 200_000);

    expect(report.closed).toBe(0);
    expect(report.open).toBe(1);
    expect(report.operations).toHaveLength(1);
    expect(report.operations[0].status).toBe("open");
    expect(report.operations[0].entry.tradeId).toBe("open-buy");
    expect(report.operations[0].exit).toBeNull();
  });

  it("classifies micro-wins separately from economically significant wins", () => {
    const report = buildOperationDossiers([strategyWithTrades([
      { id: "buy", side: "buy", timestamp: 100_000, price: 100, quantity: 0.1, grossEur: 10, feeEur: 0.04, reason: "entrada" },
      { id: "sell", side: "sell", timestamp: 160_000, price: 101, quantity: 0.1, grossEur: 10.1, feeEur: 0.0404, reason: "salida", pnlEur: 0.000028 },
    ])], 200_000);

    expect(report.significantWins).toBe(0);
    expect(report.microWins).toBe(1);
    expect(report.operations[0].exit?.economicallySignificant).toBe(false);
    expect(report.operations[0].exit?.diagnosis).toBe("winner");
  });
});
