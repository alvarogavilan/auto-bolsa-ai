import { assessPaperEconomicOutcome, type PaperEconomicOutcome } from "./paper-economic-outcome";

export interface PaperEconomicTradeLike {
  side: "buy" | "sell";
  pnlEur?: number;
  grossEur?: number;
}

export interface PaperEconomicStrategyLike {
  id: string;
  symbol: string;
  trades: PaperEconomicTradeLike[];
}

export interface PaperEconomicTradeResult {
  strategyId: string;
  symbol: string;
  netPnlEur: number;
  allocatedEur: number;
  outcome: PaperEconomicOutcome;
  countsAsWin: boolean;
  minimumMeaningfulProfitEur: number;
}

export interface PaperEconomicPerformance {
  closedTrades: number;
  meaningfulWins: number;
  microWins: number;
  flatTrades: number;
  losses: number;
  economicWinRatePct: number | null;
  netPnlEur: number;
  results: PaperEconomicTradeResult[];
}

function finite(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/**
 * Rebuilds economic outcomes from immutable PAPER trade history. This does not
 * rewrite PnL or delete legacy trades; it only prevents cent-level positives
 * from inflating the win rate shown by the engine and DEMO.
 */
export function derivePaperEconomicPerformance(
  strategies: PaperEconomicStrategyLike[],
): PaperEconomicPerformance {
  const results: PaperEconomicTradeResult[] = [];

  for (const strategy of strategies) {
    for (const trade of strategy.trades) {
      if (trade.side !== "sell" || typeof trade.pnlEur !== "number") continue;
      const netPnlEur = finite(trade.pnlEur);
      const allocatedEur = Math.max(0, finite(trade.grossEur));
      const assessment = assessPaperEconomicOutcome(netPnlEur, allocatedEur);
      results.push({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        netPnlEur,
        allocatedEur,
        outcome: assessment.outcome,
        countsAsWin: assessment.countsAsWin,
        minimumMeaningfulProfitEur: assessment.minimumMeaningfulProfitEur,
      });
    }
  }

  const meaningfulWins = results.filter((result) => result.outcome === "meaningful-win").length;
  const microWins = results.filter((result) => result.outcome === "micro-win").length;
  const flatTrades = results.filter((result) => result.outcome === "flat").length;
  const losses = results.filter((result) => result.outcome === "loss").length;
  const economicallyResolved = meaningfulWins + losses;

  return {
    closedTrades: results.length,
    meaningfulWins,
    microWins,
    flatTrades,
    losses,
    economicWinRatePct: economicallyResolved > 0 ? (meaningfulWins / economicallyResolved) * 100 : null,
    netPnlEur: results.reduce((sum, result) => sum + result.netPnlEur, 0),
    results,
  };
}
