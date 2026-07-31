import type { LabStrategyState } from "./research-lab";

export interface PaperBuyHoldBenchmark {
  schemaVersion: "paper-buy-hold-benchmark-v1";
  strategyId: string;
  pairKey: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  initializedAt: number;
  lastUpdatedAt: number;
  initialCashEur: number;
  allocatedEur: number;
  retainedCashEur: number;
  feePctEachSide: number;
  slippagePctEachSide: number;
  entryRawPrice: number;
  entryExecutionPrice: number;
  quantity: number;
  buyFeeEur: number;
  currentRawPrice: number;
  liquidationExecutionPrice: number;
  grossLiquidationEur: number;
  sellFeeEur: number;
  equityEur: number;
  peakEquityEur: number;
  maxDrawdownPct: number;
  netReturnPct: number;
  observations: number;
  liveTrading: false;
}

export type PaperBenchmarkMap = Record<string, PaperBuyHoldBenchmark>;

function round(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function validPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid benchmark market price");
  return value;
}

function markBenchmark(
  benchmark: PaperBuyHoldBenchmark,
  currentRawPrice: number,
  now: number,
): PaperBuyHoldBenchmark {
  const rawPrice = validPrice(currentRawPrice);
  const liquidationExecutionPrice = rawPrice * (1 - benchmark.slippagePctEachSide);
  const grossLiquidationEur = benchmark.quantity * liquidationExecutionPrice;
  const sellFeeEur = grossLiquidationEur * benchmark.feePctEachSide;
  const equityEur = benchmark.retainedCashEur + grossLiquidationEur - sellFeeEur;
  const peakEquityEur = Math.max(benchmark.peakEquityEur, equityEur);
  const drawdownPct = peakEquityEur > 0
    ? Math.max(0, (peakEquityEur - equityEur) / peakEquityEur)
    : 0;
  return {
    ...benchmark,
    lastUpdatedAt: now,
    currentRawPrice: rawPrice,
    liquidationExecutionPrice: round(liquidationExecutionPrice),
    grossLiquidationEur: round(grossLiquidationEur),
    sellFeeEur: round(sellFeeEur),
    equityEur: round(equityEur),
    peakEquityEur: round(peakEquityEur),
    maxDrawdownPct: Math.max(benchmark.maxDrawdownPct, drawdownPct),
    netReturnPct: round(((equityEur - benchmark.initialCashEur) / benchmark.initialCashEur) * 100),
    observations: benchmark.observations + 1,
    liveTrading: false,
  };
}

export function initializeBuyHoldBenchmark(
  strategy: LabStrategyState,
  currentRawPrice: number,
  now = Date.now(),
): PaperBuyHoldBenchmark {
  const rawPrice = validPrice(currentRawPrice);
  const allocatedEur = Math.min(10, strategy.initialCashEur * 0.2);
  const buyFeeEur = allocatedEur * strategy.config.feePctEachSide;
  const entryExecutionPrice = rawPrice * (1 + strategy.config.slippagePctEachSide);
  const quantity = allocatedEur / entryExecutionPrice;
  const retainedCashEur = strategy.initialCashEur - allocatedEur - buyFeeEur;
  const initial: PaperBuyHoldBenchmark = {
    schemaVersion: "paper-buy-hold-benchmark-v1",
    strategyId: strategy.id,
    pairKey: strategy.pairKey,
    symbol: strategy.symbol,
    lane: strategy.lane,
    initializedAt: now,
    lastUpdatedAt: now,
    initialCashEur: strategy.initialCashEur,
    allocatedEur: round(allocatedEur),
    retainedCashEur: round(retainedCashEur),
    feePctEachSide: strategy.config.feePctEachSide,
    slippagePctEachSide: strategy.config.slippagePctEachSide,
    entryRawPrice: rawPrice,
    entryExecutionPrice: round(entryExecutionPrice),
    quantity: round(quantity),
    buyFeeEur: round(buyFeeEur),
    currentRawPrice: rawPrice,
    liquidationExecutionPrice: rawPrice,
    grossLiquidationEur: 0,
    sellFeeEur: 0,
    equityEur: strategy.initialCashEur,
    peakEquityEur: strategy.initialCashEur,
    maxDrawdownPct: 0,
    netReturnPct: 0,
    observations: 0,
    liveTrading: false,
  };
  return markBenchmark(initial, rawPrice, now);
}

export function updateBuyHoldBenchmark(
  existing: PaperBuyHoldBenchmark | null,
  strategy: LabStrategyState,
  currentRawPrice: number,
  now = Date.now(),
): PaperBuyHoldBenchmark {
  if (
    !existing
    || existing.schemaVersion !== "paper-buy-hold-benchmark-v1"
    || existing.strategyId !== strategy.id
    || existing.pairKey !== strategy.pairKey
  ) {
    return initializeBuyHoldBenchmark(strategy, currentRawPrice, now);
  }
  return markBenchmark(existing, currentRawPrice, now);
}

export function sanitizeBenchmarkMap(value: unknown): PaperBenchmarkMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const benchmarks: PaperBenchmarkMap = {};
  for (const [strategyId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<PaperBuyHoldBenchmark>;
    if (
      candidate.schemaVersion !== "paper-buy-hold-benchmark-v1"
      || candidate.strategyId !== strategyId
      || typeof candidate.pairKey !== "string"
      || typeof candidate.equityEur !== "number"
      || typeof candidate.netReturnPct !== "number"
      || typeof candidate.lastUpdatedAt !== "number"
    ) continue;
    benchmarks[strategyId] = raw as PaperBuyHoldBenchmark;
  }
  return benchmarks;
}

export function buildBenchmarkComparison(
  strategies: LabStrategyState[],
  benchmarks: PaperBenchmarkMap,
): Record<string, unknown> {
  const comparisons = strategies.map((strategy) => {
    const benchmark = benchmarks[strategy.id] ?? null;
    const strategyReturnPct = round(
      ((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100,
    );
    const benchmarkReturnPct = benchmark?.netReturnPct ?? null;
    const alphaPct = benchmarkReturnPct === null
      ? null
      : round(strategyReturnPct - benchmarkReturnPct);
    return {
      strategyId: strategy.id,
      pairKey: strategy.pairKey,
      symbol: strategy.symbol,
      lane: strategy.lane,
      strategyEquityEur: strategy.equityEur,
      benchmarkEquityEur: benchmark?.equityEur ?? null,
      strategyReturnPct,
      benchmarkReturnPct,
      alphaPct,
      outperformedBenchmark: alphaPct !== null && alphaPct > 0,
      strategyMaxDrawdownPct: strategy.maxDrawdownPct,
      benchmarkMaxDrawdownPct: benchmark?.maxDrawdownPct ?? null,
      benchmarkInitializedAt: benchmark?.initializedAt ?? null,
      benchmarkLastUpdatedAt: benchmark?.lastUpdatedAt ?? null,
      benchmarkObservations: benchmark?.observations ?? 0,
      benchmarkUsesSameTenEurExposure: benchmark?.allocatedEur === 10,
    };
  });
  const measured = comparisons.filter((comparison) => comparison.alphaPct !== null);
  const alphaLeaderboard = [...measured].sort((left, right) =>
    (right.alphaPct ?? Number.NEGATIVE_INFINITY) - (left.alphaPct ?? Number.NEGATIVE_INFINITY)
    || left.strategyMaxDrawdownPct - right.strategyMaxDrawdownPct,
  );
  const laneSummary = Object.fromEntries(
    (["fast", "intraday", "swing"] as const).map((lane) => {
      const items = measured.filter((comparison) => comparison.lane === lane);
      const average = items.length > 0
        ? items.reduce((sum, item) => sum + (item.alphaPct ?? 0), 0) / items.length
        : null;
      return [lane, {
        measuredStrategies: items.length,
        outperformingStrategies: items.filter((item) => item.outperformedBenchmark).length,
        averageAlphaPct: average === null ? null : round(average),
      }];
    }),
  );
  return {
    schemaVersion: "paper-strategy-benchmark-comparison-v1",
    methodology: "Cada estrategia se compara con comprar y mantener 10 EUR del mismo activo, conservando el resto en efectivo e incluyendo comisión y deslizamiento de entrada y liquidación.",
    strategyCount: strategies.length,
    measuredStrategies: measured.length,
    outperformingStrategies: measured.filter((comparison) => comparison.outperformedBenchmark).length,
    laneSummary,
    alphaLeaderboard,
    comparisons,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
