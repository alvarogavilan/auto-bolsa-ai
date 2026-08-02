import { calculateIndicators } from "./strategy";
import type { LabStrategyState, LabTrade } from "./research-lab";
import type { Candle, Indicators } from "./types";

export interface PersistedPaperTradeEvidence {
  evidenceVersion: "paper-trade-evidence-v1";
  lane: LabStrategyState["lane"];
  estimatedSlippageEur: number;
  stopLoss: number | null;
  takeProfit: number | null;
  indicators: Indicators | null;
  linkedEntryTradeId: string | null;
  durationMinutes: number | null;
  grossPnlBeforeCostsEur: number | null;
  totalCostsEur: number;
  diagnosis: "open" | "winner" | "loser" | "flat";
  learningMayMutateParameters: false;
  liveTrading: false;
}

export type EvidencedLabTrade = LabTrade & Partial<PersistedPaperTradeEvidence>;

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function indicatorsFor(strategy: LabStrategyState, candles: Candle[]): Indicators | null {
  try {
    return calculateIndicators(
      candles,
      strategy.config.fastPeriod,
      strategy.config.slowPeriod,
      strategy.config.rsiPeriod,
    );
  } catch {
    return null;
  }
}

function chronological(trades: LabTrade[]): LabTrade[] {
  return [...trades].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

function unmatchedEntryBefore(strategy: LabStrategyState, exit: LabTrade): LabTrade | null {
  const queue: LabTrade[] = [];
  for (const trade of chronological(strategy.trades)) {
    if (trade.timestamp > exit.timestamp || (trade.timestamp === exit.timestamp && trade.id === exit.id)) break;
    if (trade.side === "buy") queue.push(trade);
    else if (queue.length > 0) queue.shift();
  }
  return queue[0] ?? null;
}

export function captureTradeIds(strategy: LabStrategyState): Set<string> {
  return new Set(strategy.trades.map((trade) => trade.id));
}

export function enrichNewPaperTrades(
  strategy: LabStrategyState,
  candles: Candle[],
  previousTradeIds: Set<string>,
): number {
  const indicators = indicatorsFor(strategy, candles);
  let enriched = 0;

  for (const rawTrade of strategy.trades) {
    if (previousTradeIds.has(rawTrade.id)) continue;
    const trade = rawTrade as EvidencedLabTrade;
    const slippage = money(trade.grossEur * strategy.config.slippagePctEachSide);

    if (trade.side === "buy") {
      Object.assign(trade, {
        evidenceVersion: "paper-trade-evidence-v1" as const,
        lane: strategy.lane,
        estimatedSlippageEur: slippage,
        stopLoss: money(trade.price * (1 - strategy.config.stopLossPct)),
        takeProfit: money(trade.price * (1 + strategy.config.takeProfitPct)),
        indicators,
        linkedEntryTradeId: null,
        durationMinutes: null,
        grossPnlBeforeCostsEur: null,
        totalCostsEur: money(trade.feeEur + slippage),
        diagnosis: "open" as const,
        learningMayMutateParameters: false as const,
        liveTrading: false as const,
      });
    } else {
      const entry = unmatchedEntryBefore(strategy, trade) as EvidencedLabTrade | null;
      const entrySlippage = entry?.estimatedSlippageEur ?? money((entry?.grossEur ?? 0) * strategy.config.slippagePctEachSide);
      const entryFee = entry?.feeEur ?? 0;
      const netPnl = trade.pnlEur ?? 0;
      const totalCosts = money(entryFee + trade.feeEur + entrySlippage + slippage);
      Object.assign(trade, {
        evidenceVersion: "paper-trade-evidence-v1" as const,
        lane: strategy.lane,
        estimatedSlippageEur: slippage,
        stopLoss: entry?.stopLoss ?? null,
        takeProfit: entry?.takeProfit ?? null,
        indicators,
        linkedEntryTradeId: entry?.id ?? null,
        durationMinutes: entry ? Math.max(0, Math.round((trade.timestamp - entry.timestamp) / 60_000)) : null,
        grossPnlBeforeCostsEur: money(netPnl + totalCosts),
        totalCostsEur: totalCosts,
        diagnosis: netPnl > 0 ? "winner" as const : netPnl < 0 ? "loser" as const : "flat" as const,
        learningMayMutateParameters: false as const,
        liveTrading: false as const,
      });
    }
    enriched += 1;
  }

  return enriched;
}
