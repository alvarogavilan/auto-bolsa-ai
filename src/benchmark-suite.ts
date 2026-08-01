import type { LabStrategyState } from "./research-lab";
import type { PaperBenchmarkMap } from "./strategy-benchmark";

export interface StrategyBenchmarkSuiteEntry {
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  strategyReturnPct: number;
  cashReturnPct: 0;
  buyHoldReturnPct: number | null;
  bestPassiveReturnPct: number;
  alphaVsCashPct: number;
  alphaVsBuyHoldPct: number | null;
  alphaVsBestPassivePct: number;
  outperformedCash: boolean;
  outperformedBuyHold: boolean;
  outperformedBestPassive: boolean;
  benchmarkObservations: number;
}

export interface StrategyBenchmarkSuite {
  schemaVersion: "paper-benchmark-suite-v1";
  methodology: string;
  strategyCount: number;
  measuredBuyHoldStrategies: number;
  outperformingCash: number;
  outperformingBuyHold: number;
  outperformingBestPassive: number;
  entries: StrategyBenchmarkSuiteEntry[];
  leaderboard: StrategyBenchmarkSuiteEntry[];
  eligibleForLiveReview: false;
  liveTrading: false;
}

function round(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function strategyReturnPct(strategy: LabStrategyState): number {
  if (!Number.isFinite(strategy.initialCashEur) || strategy.initialCashEur <= 0) return 0;
  return round(((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100);
}

export function buildBenchmarkSuite(
  strategies: LabStrategyState[],
  benchmarks: PaperBenchmarkMap,
): StrategyBenchmarkSuite {
  const entries = strategies.map((strategy): StrategyBenchmarkSuiteEntry => {
    const strategyReturn = strategyReturnPct(strategy);
    const benchmark = benchmarks[strategy.id] ?? null;
    const buyHoldReturn = benchmark?.netReturnPct ?? null;
    const bestPassiveReturn = Math.max(0, buyHoldReturn ?? 0);
    const alphaVsBuyHold = buyHoldReturn === null ? null : round(strategyReturn - buyHoldReturn);
    const alphaVsBestPassive = round(strategyReturn - bestPassiveReturn);
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      lane: strategy.lane,
      strategyReturnPct: strategyReturn,
      cashReturnPct: 0,
      buyHoldReturnPct: buyHoldReturn,
      bestPassiveReturnPct: round(bestPassiveReturn),
      alphaVsCashPct: strategyReturn,
      alphaVsBuyHoldPct: alphaVsBuyHold,
      alphaVsBestPassivePct: alphaVsBestPassive,
      outperformedCash: strategyReturn > 0,
      outperformedBuyHold: alphaVsBuyHold !== null && alphaVsBuyHold > 0,
      outperformedBestPassive: alphaVsBestPassive > 0,
      benchmarkObservations: benchmark?.observations ?? 0,
    };
  });

  const leaderboard = [...entries].sort((left, right) =>
    right.alphaVsBestPassivePct - left.alphaVsBestPassivePct
    || right.strategyReturnPct - left.strategyReturnPct
    || left.strategyId.localeCompare(right.strategyId),
  );

  return {
    schemaVersion: "paper-benchmark-suite-v1",
    methodology: "Cada estrategia compite contra conservar efectivo y contra comprar y mantener 10 EUR del mismo activo con comisiones y deslizamiento. La referencia exigente usa la mejor de ambas alternativas pasivas.",
    strategyCount: entries.length,
    measuredBuyHoldStrategies: entries.filter((entry) => entry.buyHoldReturnPct !== null).length,
    outperformingCash: entries.filter((entry) => entry.outperformedCash).length,
    outperformingBuyHold: entries.filter((entry) => entry.outperformedBuyHold).length,
    outperformingBestPassive: entries.filter((entry) => entry.outperformedBestPassive).length,
    entries,
    leaderboard,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
