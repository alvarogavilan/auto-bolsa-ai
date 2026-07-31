import type { BotSnapshot } from "./types";

export interface PaperReadiness {
  phase: "paper-validation";
  paperStartedAt: number;
  daysObserved: number;
  ticksObserved: number;
  errorsObserved: number;
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
    minimumTicks: number;
    minimumClosedTrades: number;
    positiveNetPnl: boolean;
    minimumProfitFactor: number;
    maximumDrawdownPct: number;
    zeroRuntimeErrors: boolean;
  };
  checks: {
    enoughDays: boolean;
    enoughTicks: boolean;
    enoughClosedTrades: boolean;
    positiveNetPnl: boolean;
    profitFactorAccepted: boolean;
    drawdownAccepted: boolean;
    runtimeErrorsAccepted: boolean;
  };
  eligibleForLiveReview: boolean;
  liveTrading: false;
  message: string;
}

const MINIMUM_DAYS = 14;
const MINIMUM_TICKS = 500;
const MINIMUM_CLOSED_TRADES = 30;
const MINIMUM_PROFIT_FACTOR = 1.1;
const MAXIMUM_DRAWDOWN_PCT = 0.05;

function rounded(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculatePaperReadiness(snapshot: BotSnapshot, now = Date.now()): PaperReadiness {
  const closed = snapshot.trades.filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number");
  const winning = closed.filter((trade) => (trade.pnlEur ?? 0) > 0);
  const losing = closed.filter((trade) => (trade.pnlEur ?? 0) < 0);
  const grossProfit = winning.reduce((sum, trade) => sum + (trade.pnlEur ?? 0), 0);
  const grossLoss = Math.abs(losing.reduce((sum, trade) => sum + (trade.pnlEur ?? 0), 0));
  const netPnl = closed.reduce((sum, trade) => sum + (trade.pnlEur ?? 0), 0);
  const totalFees = snapshot.trades.reduce((sum, trade) => sum + trade.feeEur, 0);
  const daysObserved = Math.max(0, Math.floor((now - snapshot.paperStartedAt) / 86_400_000));
  const currentDrawdown = snapshot.peakEquityEur > 0
    ? Math.max(0, (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur)
    : 0;
  const returnPct = snapshot.initialCashEur > 0
    ? (snapshot.equityEur - snapshot.initialCashEur) / snapshot.initialCashEur
    : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;

  const checks = {
    enoughDays: daysObserved >= MINIMUM_DAYS,
    enoughTicks: snapshot.ticksObserved >= MINIMUM_TICKS,
    enoughClosedTrades: closed.length >= MINIMUM_CLOSED_TRADES,
    positiveNetPnl: netPnl > 0,
    profitFactorAccepted: profitFactor !== null && profitFactor >= MINIMUM_PROFIT_FACTOR,
    drawdownAccepted: snapshot.maxObservedDrawdownPct <= MAXIMUM_DRAWDOWN_PCT,
    runtimeErrorsAccepted: snapshot.errorsObserved === 0,
  };
  const eligibleForLiveReview = Object.values(checks).every(Boolean);

  return {
    phase: "paper-validation",
    paperStartedAt: snapshot.paperStartedAt,
    daysObserved,
    ticksObserved: snapshot.ticksObserved,
    errorsObserved: snapshot.errorsObserved,
    closedTrades: closed.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRatePct: closed.length > 0 ? rounded((winning.length / closed.length) * 100, 2) : null,
    netPnlEur: rounded(netPnl),
    returnPct: rounded(returnPct * 100, 3),
    totalFeesEur: rounded(totalFees),
    profitFactor: profitFactor === null ? null : Number.isFinite(profitFactor) ? rounded(profitFactor, 3) : null,
    currentDrawdownPct: rounded(currentDrawdown * 100, 3),
    maxObservedDrawdownPct: rounded(snapshot.maxObservedDrawdownPct * 100, 3),
    requirements: {
      minimumDays: MINIMUM_DAYS,
      minimumTicks: MINIMUM_TICKS,
      minimumClosedTrades: MINIMUM_CLOSED_TRADES,
      positiveNetPnl: true,
      minimumProfitFactor: MINIMUM_PROFIT_FACTOR,
      maximumDrawdownPct: MAXIMUM_DRAWDOWN_PCT * 100,
      zeroRuntimeErrors: true,
    },
    checks,
    eligibleForLiveReview,
    liveTrading: false,
    message: eligibleForLiveReview
      ? "La fase PAPER cumple los mínimos para una revisión humana. El trading real sigue bloqueado."
      : "La fase PAPER todavía no cumple todos los mínimos. No se permite usar dinero real.",
  };
}
