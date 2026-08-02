import type {
  LabPerformance,
  LabPosition,
  LabStrategyState,
  LabTrade,
  ResearchLabState,
} from "./research-lab";
import { evaluateNegativePatternVeto } from "./paper-negative-pattern-veto";
import { evaluateTreasuryEntry, type TreasuryDecision } from "./treasury-risk";

const GLOBAL_PAPER_LOSS_STREAK_LIMIT = 3;

export interface PaperEntrySnapshot {
  cashEur: number;
  equityEur: number;
  peakEquityEur: number;
  maxDrawdownPct: number;
  position: LabPosition | null;
  lastTradeAt: number | null;
  performance: LabPerformance;
  trades: LabTrade[];
  lastDecision: string;
}

export interface PaperEntryTreasuryGateResult {
  newEntryDetected: boolean;
  allowed: boolean;
  resized: boolean;
  decision: TreasuryDecision | null;
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function capturePaperEntrySnapshot(strategy: LabStrategyState): PaperEntrySnapshot {
  return {
    cashEur: strategy.cashEur,
    equityEur: strategy.equityEur,
    peakEquityEur: strategy.peakEquityEur,
    maxDrawdownPct: strategy.maxDrawdownPct,
    position: strategy.position ? { ...strategy.position } : null,
    lastTradeAt: strategy.lastTradeAt,
    performance: { ...strategy.performance },
    trades: strategy.trades.map((trade) => ({ ...trade })),
    lastDecision: strategy.lastDecision,
  };
}

function restoreSnapshot(strategy: LabStrategyState, snapshot: PaperEntrySnapshot, reason: string): void {
  strategy.cashEur = snapshot.cashEur;
  strategy.equityEur = snapshot.equityEur;
  strategy.peakEquityEur = snapshot.peakEquityEur;
  strategy.maxDrawdownPct = snapshot.maxDrawdownPct;
  strategy.position = snapshot.position ? { ...snapshot.position } : null;
  strategy.lastTradeAt = snapshot.lastTradeAt;
  strategy.performance = { ...snapshot.performance };
  strategy.trades = snapshot.trades.map((trade) => ({ ...trade }));
  strategy.lastDecision = reason;
}

function stateBeforeEntry(
  strategy: LabStrategyState,
  state: ResearchLabState,
  snapshot: PaperEntrySnapshot,
): ResearchLabState {
  return {
    ...state,
    strategies: state.strategies.map((item) => item === strategy ? {
      ...item,
      cashEur: snapshot.cashEur,
      equityEur: snapshot.equityEur,
      peakEquityEur: snapshot.peakEquityEur,
      maxDrawdownPct: snapshot.maxDrawdownPct,
      position: snapshot.position ? { ...snapshot.position } : null,
      lastTradeAt: snapshot.lastTradeAt,
      performance: { ...snapshot.performance },
      trades: snapshot.trades.map((trade) => ({ ...trade })),
      lastDecision: snapshot.lastDecision,
    } : item),
  };
}

interface ClosedPaperTrade {
  timestamp: number;
  pnlEur: number;
}

function recentGlobalClosedTrades(state: ResearchLabState, maximum = 20): ClosedPaperTrade[] {
  return state.strategies
    .flatMap((item) => item.trades)
    .filter((trade): trade is LabTrade & { pnlEur: number } => (
      trade.side === "sell"
      && typeof trade.pnlEur === "number"
      && Number.isFinite(trade.pnlEur)
    ))
    .map((trade) => ({ timestamp: trade.timestamp, pnlEur: trade.pnlEur }))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, maximum);
}

export function globalPaperLosingStreak(state: ResearchLabState): number {
  const recent = recentGlobalClosedTrades(state);
  const firstNonLoss = recent.findIndex((trade) => trade.pnlEur >= 0);
  return firstNonLoss === -1 ? recent.length : firstNonLoss;
}

function exceptionalGlobalRecoveryEntry(strategy: LabStrategyState, latest: LabTrade | undefined): boolean {
  if (!latest || latest.side !== "buy") return false;
  const reason = latest.reason.toLowerCase();
  const confirmedContinuation = reason.includes("ruptura") || reason.includes("continuación");
  const expectedMove = Math.max(strategy.config.takeProfitPct, 0.0001);
  const costRatio = strategy.estimatedTakerRoundTripCostPct / expectedMove;
  const noKnownVeto = !strategy.lastDecision.toLowerCase().includes("veto");
  return confirmedContinuation && costRatio <= 0.2 && noKnownVeto;
}

export function enforcePaperTreasuryEntry(
  strategy: LabStrategyState,
  state: ResearchLabState,
  snapshot: PaperEntrySnapshot,
): PaperEntryTreasuryGateResult {
  if (strategy.position === null) {
    return { newEntryDetected: false, allowed: true, resized: false, decision: null, liveTrading: false };
  }

  const previousCostEur = snapshot.position?.costEur ?? 0;
  const increasedCostEur = strategy.position.costEur - previousCostEur;
  const latest = strategy.trades[0];
  const latestIsNewBuy = latest?.side === "buy"
    && (snapshot.trades[0]?.id !== latest.id || strategy.trades.length > snapshot.trades.length);
  if (!latestIsNewBuy && increasedCostEur <= 0.000001) {
    return { newEntryDetected: false, allowed: true, resized: false, decision: null, liveTrading: false };
  }

  const preEntryState = stateBeforeEntry(strategy, state, snapshot);
  const negativePattern = evaluateNegativePatternVeto(strategy, preEntryState, latest);
  if (negativePattern.blocked) {
    const factor = negativePattern.profitFactor === null
      ? "0"
      : Number.isFinite(negativePattern.profitFactor) ? negativePattern.profitFactor.toFixed(2) : "∞";
    restoreSnapshot(
      strategy,
      snapshot,
      `PAPER BUY vetada por patrón negativo con evidencia suficiente: ${negativePattern.sampleSize} cierres del mismo carril, activo y motivo de entrada; PnL ${negativePattern.netPnlEur.toFixed(4)} €; profit factor ${factor}.`,
    );
    return { newEntryDetected: true, allowed: false, resized: false, decision: null, liveTrading: false };
  }

  const globalLosingStreak = globalPaperLosingStreak(preEntryState);
  if (
    globalLosingStreak >= GLOBAL_PAPER_LOSS_STREAK_LIMIT
    && !exceptionalGlobalRecoveryEntry(strategy, latest)
  ) {
    restoreSnapshot(
      strategy,
      snapshot,
      `PAPER BUY vetada por freno global de Tesorería tras ${globalLosingStreak} pérdidas consecutivas de cartera. Solo se admite una ruptura o continuación confirmada con costes excepcionalmente bajos.`,
    );
    return { newEntryDetected: true, allowed: false, resized: false, decision: null, liveTrading: false };
  }

  const requestedGrossEur = latestIsNewBuy && latest
    ? latest.grossEur
    : increasedCostEur / (1 + strategy.config.feePctEachSide);
  const decision = evaluateTreasuryEntry(strategy, preEntryState, requestedGrossEur);

  if (!decision.allowed || decision.maximumBudgetEur < 5) {
    restoreSnapshot(
      strategy,
      snapshot,
      `PAPER BUY vetada por Tesorería única: ${decision.reasons.join(" · ")}`,
    );
    return { newEntryDetected: true, allowed: false, resized: false, decision, liveTrading: false };
  }

  const approvedGrossEur = decision.maximumBudgetEur;
  const mustResize = Math.abs(approvedGrossEur - requestedGrossEur) > 0.000001;
  if (mustResize) {
    if (!latest || latest.side !== "buy" || latest.price <= 0) {
      restoreSnapshot(strategy, snapshot, "PAPER BUY vetada: Tesorería no pudo reconciliar el tamaño de la entrada.");
      return { newEntryDetected: true, allowed: false, resized: false, decision, liveTrading: false };
    }
    const feeEur = approvedGrossEur * strategy.config.feePctEachSide;
    const totalIncrementalCostEur = approvedGrossEur + feeEur;
    if (totalIncrementalCostEur > snapshot.cashEur) {
      restoreSnapshot(strategy, snapshot, "PAPER BUY vetada: saldo insuficiente para el presupuesto aprobado por Tesorería.");
      return { newEntryDetected: true, allowed: false, resized: false, decision, liveTrading: false };
    }
    const addedQuantity = approvedGrossEur / latest.price;
    const previousQuantity = snapshot.position?.quantity ?? 0;
    const totalQuantity = previousQuantity + addedQuantity;
    strategy.cashEur = money(snapshot.cashEur - totalIncrementalCostEur);
    strategy.position = {
      ...strategy.position,
      quantity: totalQuantity,
      costEur: money(previousCostEur + totalIncrementalCostEur),
    };
    strategy.performance.totalFeesEur = money(snapshot.performance.totalFeesEur + feeEur);
    latest.quantity = addedQuantity;
    latest.grossEur = approvedGrossEur;
    latest.feeEur = feeEur;
    latest.reason = `${latest.reason}. Tesorería única autorizó ${approvedGrossEur.toFixed(2)} €.`;
    strategy.equityEur = money(strategy.cashEur + totalQuantity * latest.price);
  }

  strategy.lastDecision = `${strategy.lastDecision} Autorización Tesorería: ${approvedGrossEur.toFixed(2)} €; exposición previa ${decision.totalOpenExposureEur.toFixed(2)} €.`;
  return { newEntryDetected: true, allowed: true, resized: mustResize, decision, liveTrading: false };
}
