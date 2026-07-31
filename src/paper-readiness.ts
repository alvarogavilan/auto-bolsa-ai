import type { BotSnapshot } from "./types";

export interface PaperReadiness {
  phase: "paper-validation";
  evidenceMethod: "closed-15m-candles-v1";
  evidenceStartedAt: number;
  daysObserved: number;
  tickAttempts: number;
  uniqueClosedCandlesObserved: number;
  duplicateCandleSkips: number;
  errorsObserved: number;
  errorRatePct: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number | null;
  netPnlEur: number;
  returnPct: number;
  totalFeesEur: number;
  profitFactor: number | null;
  currentDrawdownPct: number;
  maxObservedDrawdownPct: number;
  requirements: {
    minimumDays: number;
    minimumUniqueClosedCandles: number;
    minimumClosedTrades: number;
    positiveNetPnl: boolean;
    minimumProfitFactor: number;
    maximumDrawdownPct: number;
    maximumErrorRatePct: number;
  };
  checks: {
    enoughDays: boolean;
    enoughUniqueClosedCandles: boolean;
    enoughClosedTrades: boolean;
    positiveNetPnl: boolean;
    profitFactorAccepted: boolean;
    drawdownAccepted: boolean;
    errorRateAccepted: boolean;
  };
  eligibleForLiveReview: boolean;
  liveTrading: false;
  message: string;
}

const MINIMUM_DAYS = 14;
const MINIMUM_UNIQUE_CLOSED_CANDLES = 500;
const MINIMUM_CLOSED_TRADES = 30;
const MINIMUM_PROFIT_FACTOR = 1.1;
const MAXIMUM_DRAWDOWN_PCT = 0.05;
const MAXIMUM_ERROR_RATE_PCT = 1;

function rounded(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculatePaperReadiness(snapshot: BotSnapshot, now = Date.now()): PaperReadiness {
  const performance = snapshot.performance;
  const daysObserved = Math.max(0, Math.floor((now - snapshot.evidenceStartedAt) / 86_400_000));
  const currentDrawdown = snapshot.peakEquityEur > 0
    ? Math.max(0, (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur)
    : 0;
  const returnPct = snapshot.initialCashEur > 0
    ? (snapshot.equityEur - snapshot.initialCashEur) / snapshot.initialCashEur
    : 0;
  const totalAttempts = snapshot.ticksObserved + snapshot.errorsObserved;
  const errorRatePct = totalAttempts > 0
    ? (snapshot.errorsObserved / totalAttempts) * 100
    : 0;
  const profitFactor = performance.grossLossEur > 0
    ? performance.grossProfitEur / performance.grossLossEur
    : null;
  const profitFactorAccepted = performance.grossLossEur === 0
    ? performance.grossProfitEur > 0
    : (profitFactor ?? 0) >= MINIMUM_PROFIT_FACTOR;

  const checks = {
    enoughDays: daysObserved >= MINIMUM_DAYS,
    enoughUniqueClosedCandles:
      snapshot.uniqueClosedCandlesObserved >= MINIMUM_UNIQUE_CLOSED_CANDLES,
    enoughClosedTrades: performance.closedTrades >= MINIMUM_CLOSED_TRADES,
    positiveNetPnl: performance.netPnlEur > 0,
    profitFactorAccepted,
    drawdownAccepted: snapshot.maxObservedDrawdownPct <= MAXIMUM_DRAWDOWN_PCT,
    errorRateAccepted: errorRatePct <= MAXIMUM_ERROR_RATE_PCT,
  };
  const eligibleForLiveReview = Object.values(checks).every(Boolean);

  return {
    phase: "paper-validation",
    evidenceMethod: snapshot.evidenceMethod,
    evidenceStartedAt: snapshot.evidenceStartedAt,
    daysObserved,
    tickAttempts: snapshot.ticksObserved,
    uniqueClosedCandlesObserved: snapshot.uniqueClosedCandlesObserved,
    duplicateCandleSkips: snapshot.duplicateCandleSkips,
    errorsObserved: snapshot.errorsObserved,
    errorRatePct: rounded(errorRatePct, 3),
    closedTrades: performance.closedTrades,
    winningTrades: performance.winningTrades,
    losingTrades: performance.losingTrades,
    winRatePct: performance.closedTrades > 0
      ? rounded((performance.winningTrades / performance.closedTrades) * 100, 2)
      : null,
    netPnlEur: rounded(performance.netPnlEur),
    returnPct: rounded(returnPct * 100, 3),
    totalFeesEur: rounded(performance.totalFeesEur),
    profitFactor: profitFactor === null ? null : rounded(profitFactor, 3),
    currentDrawdownPct: rounded(currentDrawdown * 100, 3),
    maxObservedDrawdownPct: rounded(snapshot.maxObservedDrawdownPct * 100, 3),
    requirements: {
      minimumDays: MINIMUM_DAYS,
      minimumUniqueClosedCandles: MINIMUM_UNIQUE_CLOSED_CANDLES,
      minimumClosedTrades: MINIMUM_CLOSED_TRADES,
      positiveNetPnl: true,
      minimumProfitFactor: MINIMUM_PROFIT_FACTOR,
      maximumDrawdownPct: MAXIMUM_DRAWDOWN_PCT * 100,
      maximumErrorRatePct: MAXIMUM_ERROR_RATE_PCT,
    },
    checks,
    eligibleForLiveReview,
    liveTrading: false,
    message: eligibleForLiveReview
      ? "La evidencia PAPER de velas cerradas cumple los mínimos para una revisión humana. El trading real sigue bloqueado."
      : "La evidencia PAPER todavía no cumple todos los mínimos. No se permite usar dinero real.",
  };
}
