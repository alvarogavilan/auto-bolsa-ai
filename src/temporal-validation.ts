import type { LabStrategyState } from "./research-lab";

export type TemporalValidationVerdict =
  | "insufficient"
  | "unstable"
  | "developing"
  | "robust_candidate";

export interface TemporalSliceMetrics {
  trades: number;
  wins: number;
  losses: number;
  flats: number;
  winRatePct: number | null;
  netPnlEur: number;
  grossProfitEur: number;
  grossLossEur: number;
  profitFactor: number | null;
  profitFactorNoLosses: boolean;
  averagePnlEur: number | null;
  largestWinEur: number | null;
  largestLossEur: number | null;
  positivePnlConcentrationPct: number | null;
  startAt: number | null;
  endAt: number | null;
}

export interface TemporalValidationFold {
  index: number;
  label: string;
  metrics: TemporalSliceMetrics;
  positive: boolean;
}

export interface StrategyTemporalValidation {
  schemaVersion: "paper-temporal-validation-entry-v1";
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  totalClosedTrades: number;
  trainingSharePct: 60;
  validationSharePct: 40;
  training: TemporalSliceMetrics;
  validation: TemporalSliceMetrics;
  rollingFolds: TemporalValidationFold[];
  positiveRollingFolds: number;
  evaluatedRollingFolds: number;
  stabilityScore: number;
  verdict: TemporalValidationVerdict;
  blockers: string[];
  warnings: string[];
  interpretation: string;
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export interface TemporalValidationReport {
  schemaVersion: "paper-temporal-validation-report-v1";
  methodology: string;
  strategyCount: number;
  sufficientlySampledStrategies: number;
  robustCandidates: number;
  developingStrategies: number;
  unstableStrategies: number;
  insufficientStrategies: number;
  minimumClosedTrades: 30;
  entries: StrategyTemporalValidation[];
  leaderboard: StrategyTemporalValidation[];
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

interface ClosedTradeObservation {
  id: string;
  timestamp: number;
  pnlEur: number;
}

const MINIMUM_CLOSED_TRADES = 30;
const ROLLING_FOLD_COUNT = 3;

function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function closedTrades(strategy: LabStrategyState): ClosedTradeObservation[] {
  return strategy.trades
    .filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number" && Number.isFinite(trade.pnlEur))
    .map((trade) => ({ id: trade.id, timestamp: trade.timestamp, pnlEur: trade.pnlEur as number }))
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

function metrics(observations: ClosedTradeObservation[]): TemporalSliceMetrics {
  const pnls = observations.map((item) => item.pnlEur);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const flats = pnls.length - wins.length - losses.length;
  const grossProfitEur = wins.reduce((sum, value) => sum + value, 0);
  const grossLossEur = losses.reduce((sum, value) => sum + Math.abs(value), 0);
  const netPnlEur = pnls.reduce((sum, value) => sum + value, 0);
  const largestWin = wins.length > 0 ? Math.max(...wins) : null;
  const largestLoss = losses.length > 0 ? Math.min(...losses) : null;
  const concentration = largestWin !== null && grossProfitEur > 0
    ? (largestWin / grossProfitEur) * 100
    : null;

  return {
    trades: observations.length,
    wins: wins.length,
    losses: losses.length,
    flats,
    winRatePct: observations.length > 0 ? round((wins.length / observations.length) * 100, 4) : null,
    netPnlEur: round(netPnlEur, 6),
    grossProfitEur: round(grossProfitEur, 6),
    grossLossEur: round(grossLossEur, 6),
    profitFactor: grossLossEur > 0 ? round(grossProfitEur / grossLossEur, 6) : null,
    profitFactorNoLosses: grossLossEur === 0 && grossProfitEur > 0,
    averagePnlEur: observations.length > 0 ? round(netPnlEur / observations.length, 6) : null,
    largestWinEur: largestWin === null ? null : round(largestWin, 6),
    largestLossEur: largestLoss === null ? null : round(largestLoss, 6),
    positivePnlConcentrationPct: concentration === null ? null : round(concentration, 4),
    startAt: observations[0]?.timestamp ?? null,
    endAt: observations.at(-1)?.timestamp ?? null,
  };
}

function profitFactorAtLeast(value: TemporalSliceMetrics, minimum: number): boolean {
  if (value.profitFactorNoLosses) return value.grossProfitEur > 0;
  return (value.profitFactor ?? 0) >= minimum;
}

function balancedFolds(observations: ClosedTradeObservation[]): ClosedTradeObservation[][] {
  if (observations.length === 0) return [];
  const count = Math.min(ROLLING_FOLD_COUNT, observations.length);
  const baseSize = Math.floor(observations.length / count);
  const remainder = observations.length % count;
  const folds: ClosedTradeObservation[][] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    folds.push(observations.slice(cursor, cursor + size));
    cursor += size;
  }
  return folds;
}

function stabilityScore(
  totalClosedTrades: number,
  training: TemporalSliceMetrics,
  validation: TemporalSliceMetrics,
  rolling: TemporalValidationFold[],
): number {
  let score = 0;
  if (totalClosedTrades >= MINIMUM_CLOSED_TRADES) score += 20;
  if (training.netPnlEur > 0) score += 10;
  if (profitFactorAtLeast(training, 1.1)) score += 10;
  if (validation.netPnlEur > 0) score += 20;
  if (profitFactorAtLeast(validation, 1.0)) score += 15;
  const positiveFolds = rolling.filter((fold) => fold.positive).length;
  if (rolling.length >= 3 && positiveFolds >= 2) score += 15;
  if ((validation.positivePnlConcentrationPct ?? 0) <= 60) score += 10;
  return Math.min(100, score);
}

function evaluateStrategy(strategy: LabStrategyState): StrategyTemporalValidation {
  const observations = closedTrades(strategy);
  const trainingCount = observations.length > 1
    ? Math.max(1, Math.min(observations.length - 1, Math.floor(observations.length * 0.6)))
    : observations.length;
  const trainingObservations = observations.slice(0, trainingCount);
  const validationObservations = observations.slice(trainingCount);
  const training = metrics(trainingObservations);
  const validation = metrics(validationObservations);
  const rollingFolds = balancedFolds(observations).map((fold, index): TemporalValidationFold => {
    const foldMetrics = metrics(fold);
    return {
      index,
      label: `Bloque temporal ${index + 1}`,
      metrics: foldMetrics,
      positive: foldMetrics.netPnlEur > 0,
    };
  });
  const positiveRollingFolds = rollingFolds.filter((fold) => fold.positive).length;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (observations.length < MINIMUM_CLOSED_TRADES) {
    blockers.push(`Solo hay ${observations.length} operaciones cerradas; se exigen al menos ${MINIMUM_CLOSED_TRADES}.`);
  }
  if (training.trades > 0 && training.netPnlEur <= 0) blockers.push("El tramo inicial no es rentable.");
  if (training.trades > 0 && !profitFactorAtLeast(training, 1.1)) blockers.push("El profit factor del tramo inicial es inferior a 1,10.");
  if (validation.trades > 0 && validation.netPnlEur <= 0) blockers.push("El tramo posterior fuera de muestra no es rentable.");
  if (validation.trades > 0 && !profitFactorAtLeast(validation, 1.0)) blockers.push("El profit factor del tramo posterior es inferior a 1,00.");
  if (rollingFolds.length >= 3 && positiveRollingFolds < 2) blockers.push("Menos de dos de los tres bloques temporales son positivos.");
  if ((validation.positivePnlConcentrationPct ?? 0) > 60) {
    blockers.push("Más del 60 % del beneficio positivo del tramo posterior depende de una sola operación.");
  }
  if (validation.trades === 0) warnings.push("Todavía no existe tramo posterior evaluable.");
  if (observations.length >= MINIMUM_CLOSED_TRADES && observations.length < 60) {
    warnings.push("La muestra supera el mínimo inicial, pero aún es pequeña para una conclusión fuerte.");
  }

  const score = stabilityScore(observations.length, training, validation, rollingFolds);
  let verdict: TemporalValidationVerdict;
  if (observations.length < MINIMUM_CLOSED_TRADES) verdict = "insufficient";
  else if (blockers.length > 0) verdict = "unstable";
  else if (observations.length < 60 || validation.trades < 12) verdict = "developing";
  else verdict = "robust_candidate";

  const interpretation = verdict === "robust_candidate"
    ? "La estrategia mantiene resultado positivo en el tramo posterior y en la mayoría de bloques temporales. Sigue siendo evidencia PAPER, no autorización LIVE."
    : verdict === "developing"
      ? "La validación temporal es favorable, pero la muestra posterior todavía es limitada."
      : verdict === "unstable"
        ? "La rentabilidad no se mantiene de forma suficientemente estable a través del tiempo."
        : "La muestra cerrada aún no permite separar con rigor un tramo inicial y otro posterior.";

  return {
    schemaVersion: "paper-temporal-validation-entry-v1",
    strategyId: strategy.id,
    symbol: strategy.symbol,
    lane: strategy.lane,
    totalClosedTrades: observations.length,
    trainingSharePct: 60,
    validationSharePct: 40,
    training,
    validation,
    rollingFolds,
    positiveRollingFolds,
    evaluatedRollingFolds: rollingFolds.length,
    stabilityScore: score,
    verdict,
    blockers,
    warnings,
    interpretation,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

export function buildTemporalValidationReport(strategies: LabStrategyState[]): TemporalValidationReport {
  const entries = strategies.map(evaluateStrategy);
  const rank = (verdict: TemporalValidationVerdict): number => {
    if (verdict === "robust_candidate") return 4;
    if (verdict === "developing") return 3;
    if (verdict === "unstable") return 2;
    return 1;
  };
  const leaderboard = [...entries].sort((left, right) =>
    rank(right.verdict) - rank(left.verdict)
    || right.stabilityScore - left.stabilityScore
    || right.validation.netPnlEur - left.validation.netPnlEur
    || left.strategyId.localeCompare(right.strategyId),
  );

  return {
    schemaVersion: "paper-temporal-validation-report-v1",
    methodology: "Validación cronológica sin reoptimización: 60 % inicial y 40 % posterior, más tres bloques temporales equilibrados. Se exige rentabilidad posterior, profit factor, mayoría de bloques positivos y baja dependencia de una única ganancia.",
    strategyCount: entries.length,
    sufficientlySampledStrategies: entries.filter((entry) => entry.totalClosedTrades >= MINIMUM_CLOSED_TRADES).length,
    robustCandidates: entries.filter((entry) => entry.verdict === "robust_candidate").length,
    developingStrategies: entries.filter((entry) => entry.verdict === "developing").length,
    unstableStrategies: entries.filter((entry) => entry.verdict === "unstable").length,
    insufficientStrategies: entries.filter((entry) => entry.verdict === "insufficient").length,
    minimumClosedTrades: MINIMUM_CLOSED_TRADES,
    entries,
    leaderboard,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
