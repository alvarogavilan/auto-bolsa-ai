import type { LabStrategyState, LabTrade } from "./research-lab";

export interface PaperOperationDossier {
  operationId: string;
  strategyId: string;
  lane: LabStrategyState["lane"];
  symbol: string;
  status: "open" | "closed";
  entry: {
    tradeId: string;
    timestamp: number;
    price: number;
    quantity: number;
    grossEur: number;
    feeEur: number;
    estimatedSlippageEur: number;
    stopLoss: number;
    takeProfit: number;
    reason: string;
  };
  exit: null | {
    tradeId: string;
    timestamp: number;
    price: number;
    grossEur: number;
    feeEur: number;
    estimatedSlippageEur: number;
    reason: string;
    durationMinutes: number;
    grossPnlBeforeExitFeeEur: number;
    totalCostsEur: number;
    netPnlEur: number;
    diagnosis: "winner" | "loser" | "flat";
    economicallySignificant: boolean;
  };
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function chronological(trades: LabTrade[]): LabTrade[] {
  return [...trades].sort((a, b) => a.timestamp - b.timestamp);
}

function operationMinimumEur(strategy: LabStrategyState): number {
  return Math.max(0.1, Math.min(1, strategy.initialCashEur * 0.002));
}

export function buildOperationDossiers(strategies: LabStrategyState[], now = Date.now()) {
  const operations: PaperOperationDossier[] = [];

  for (const strategy of strategies) {
    const queue: LabTrade[] = [];
    for (const trade of chronological(strategy.trades)) {
      if (trade.side === "buy") {
        queue.push(trade);
        continue;
      }
      const buy = queue.shift();
      if (!buy) continue;
      const entrySlippage = buy.grossEur * strategy.config.slippagePctEachSide;
      const exitSlippage = trade.grossEur * strategy.config.slippagePctEachSide;
      const netPnl = trade.pnlEur ?? 0;
      const grossBeforeExitFee = netPnl + buy.feeEur + trade.feeEur;
      operations.push({
        operationId: `${strategy.id}:${buy.id}:${trade.id}`,
        strategyId: strategy.id,
        lane: strategy.lane,
        symbol: strategy.symbol,
        status: "closed",
        entry: {
          tradeId: buy.id,
          timestamp: buy.timestamp,
          price: buy.price,
          quantity: buy.quantity,
          grossEur: money(buy.grossEur),
          feeEur: money(buy.feeEur),
          estimatedSlippageEur: money(entrySlippage),
          stopLoss: money(buy.price * (1 - strategy.config.stopLossPct)),
          takeProfit: money(buy.price * (1 + strategy.config.takeProfitPct)),
          reason: buy.reason,
        },
        exit: {
          tradeId: trade.id,
          timestamp: trade.timestamp,
          price: trade.price,
          grossEur: money(trade.grossEur),
          feeEur: money(trade.feeEur),
          estimatedSlippageEur: money(exitSlippage),
          reason: trade.reason,
          durationMinutes: Math.max(0, Math.round((trade.timestamp - buy.timestamp) / 60_000)),
          grossPnlBeforeExitFeeEur: money(grossBeforeExitFee),
          totalCostsEur: money(buy.feeEur + trade.feeEur + entrySlippage + exitSlippage),
          netPnlEur: money(netPnl),
          diagnosis: netPnl > 0 ? "winner" : netPnl < 0 ? "loser" : "flat",
          economicallySignificant: netPnl >= operationMinimumEur(strategy),
        },
        liveTrading: false,
      });
    }

    for (const buy of queue) {
      operations.push({
        operationId: `${strategy.id}:${buy.id}:open`,
        strategyId: strategy.id,
        lane: strategy.lane,
        symbol: strategy.symbol,
        status: "open",
        entry: {
          tradeId: buy.id,
          timestamp: buy.timestamp,
          price: buy.price,
          quantity: buy.quantity,
          grossEur: money(buy.grossEur),
          feeEur: money(buy.feeEur),
          estimatedSlippageEur: money(buy.grossEur * strategy.config.slippagePctEachSide),
          stopLoss: money(buy.price * (1 - strategy.config.stopLossPct)),
          takeProfit: money(buy.price * (1 + strategy.config.takeProfitPct)),
          reason: buy.reason,
        },
        exit: null,
        liveTrading: false,
      });
    }
  }

  operations.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
  const closedOperations = operations.filter((operation) => operation.exit !== null);
  return {
    schemaVersion: "paper-operation-dossiers-v1" as const,
    generatedAt: now,
    operations,
    closed: closedOperations.length,
    open: operations.length - closedOperations.length,
    significantWins: closedOperations.filter((operation) => operation.exit!.netPnlEur > 0 && operation.exit!.economicallySignificant).length,
    microWins: closedOperations.filter((operation) => operation.exit!.netPnlEur > 0 && !operation.exit!.economicallySignificant).length,
    losses: closedOperations.filter((operation) => operation.exit!.netPnlEur < 0).length,
    sourceOfTruth: "state.strategies[].trades" as const,
    learningMayMutateParameters: false as const,
    liveTrading: false as const,
  };
}
