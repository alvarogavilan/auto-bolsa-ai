import type { LabStrategyState, LabTrade } from "./research-lab";
import type { EvidencedLabTrade } from "./paper-trade-evidence-enrichment";
import type { Indicators } from "./types";

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
    indicators: Indicators | null;
    evidencePersisted: boolean;
  };
  exit: null | {
    tradeId: string;
    linkedEntryTradeId: string;
    timestamp: number;
    price: number;
    grossEur: number;
    feeEur: number;
    estimatedSlippageEur: number;
    reason: string;
    durationMinutes: number;
    grossPnlBeforeExitFeeEur: number;
    grossPnlBeforeCostsEur: number;
    totalCostsEur: number;
    netPnlEur: number;
    diagnosis: "winner" | "loser" | "flat";
    economicallySignificant: boolean;
    evidencePersisted: boolean;
  };
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function chronological(trades: LabTrade[]): LabTrade[] {
  return [...trades].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

function operationMinimumEur(strategy: LabStrategyState): number {
  return Math.max(0.1, Math.min(1, strategy.initialCashEur * 0.002));
}

function evidence(trade: LabTrade): EvidencedLabTrade {
  return trade as EvidencedLabTrade;
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
      const buyEvidence = evidence(buy);
      const exitEvidence = evidence(trade);
      const entrySlippage = buyEvidence.estimatedSlippageEur ?? buy.grossEur * strategy.config.slippagePctEachSide;
      const exitSlippage = exitEvidence.estimatedSlippageEur ?? trade.grossEur * strategy.config.slippagePctEachSide;
      const netPnl = trade.pnlEur ?? 0;
      const totalCosts = exitEvidence.totalCostsEur ?? money(buy.feeEur + trade.feeEur + entrySlippage + exitSlippage);
      const grossBeforeCosts = exitEvidence.grossPnlBeforeCostsEur ?? money(netPnl + totalCosts);
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
          stopLoss: money(buyEvidence.stopLoss ?? buy.price * (1 - strategy.config.stopLossPct)),
          takeProfit: money(buyEvidence.takeProfit ?? buy.price * (1 + strategy.config.takeProfitPct)),
          reason: buy.reason,
          indicators: buyEvidence.indicators ?? null,
          evidencePersisted: buyEvidence.evidenceVersion === "paper-trade-evidence-v1",
        },
        exit: {
          tradeId: trade.id,
          linkedEntryTradeId: exitEvidence.linkedEntryTradeId ?? buy.id,
          timestamp: trade.timestamp,
          price: trade.price,
          grossEur: money(trade.grossEur),
          feeEur: money(trade.feeEur),
          estimatedSlippageEur: money(exitSlippage),
          reason: trade.reason,
          durationMinutes: exitEvidence.durationMinutes ?? Math.max(0, Math.round((trade.timestamp - buy.timestamp) / 60_000)),
          grossPnlBeforeExitFeeEur: money(grossBeforeExitFee),
          grossPnlBeforeCostsEur: money(grossBeforeCosts),
          totalCostsEur: money(totalCosts),
          netPnlEur: money(netPnl),
          diagnosis: exitEvidence.diagnosis === "winner" || exitEvidence.diagnosis === "loser" || exitEvidence.diagnosis === "flat"
            ? exitEvidence.diagnosis
            : netPnl > 0 ? "winner" : netPnl < 0 ? "loser" : "flat",
          economicallySignificant: netPnl >= operationMinimumEur(strategy),
          evidencePersisted: exitEvidence.evidenceVersion === "paper-trade-evidence-v1",
        },
        liveTrading: false,
      });
    }

    for (const buy of queue) {
      const buyEvidence = evidence(buy);
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
          estimatedSlippageEur: money(buyEvidence.estimatedSlippageEur ?? buy.grossEur * strategy.config.slippagePctEachSide),
          stopLoss: money(buyEvidence.stopLoss ?? buy.price * (1 - strategy.config.stopLossPct)),
          takeProfit: money(buyEvidence.takeProfit ?? buy.price * (1 + strategy.config.takeProfitPct)),
          reason: buy.reason,
          indicators: buyEvidence.indicators ?? null,
          evidencePersisted: buyEvidence.evidenceVersion === "paper-trade-evidence-v1",
        },
        exit: null,
        liveTrading: false,
      });
    }
  }

  operations.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
  const closedOperations = operations.filter((operation) => operation.exit !== null);
  const evidenceComplete = operations.filter((operation) => operation.entry.evidencePersisted && (!operation.exit || operation.exit.evidencePersisted)).length;
  return {
    schemaVersion: "paper-operation-dossiers-v2" as const,
    generatedAt: now,
    operations,
    closed: closedOperations.length,
    open: operations.length - closedOperations.length,
    significantWins: closedOperations.filter((operation) => operation.exit!.netPnlEur > 0 && operation.exit!.economicallySignificant).length,
    microWins: closedOperations.filter((operation) => operation.exit!.netPnlEur > 0 && !operation.exit!.economicallySignificant).length,
    losses: closedOperations.filter((operation) => operation.exit!.netPnlEur < 0).length,
    evidenceComplete,
    evidenceCoveragePct: operations.length > 0 ? Math.round((evidenceComplete / operations.length) * 100) : 100,
    sourceOfTruth: "state.strategies[].trades" as const,
    learningMayMutateParameters: false as const,
    liveTrading: false as const,
  };
}
