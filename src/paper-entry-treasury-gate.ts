import type {
  LabPerformance,
  LabPosition,
  LabStrategyState,
  LabTrade,
  ResearchLabState,
} from "./research-lab";
import { evaluateTreasuryEntry, type TreasuryDecision } from "./treasury-risk";

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

export function enforcePaperTreasuryEntry(
  strategy: LabStrategyState,
  state: ResearchLabState,
  snapshot: PaperEntrySnapshot,
): PaperEntryTreasuryGateResult {
  if (snapshot.position !== null || strategy.position === null) {
    return { newEntryDetected: false, allowed: true, resized: false, decision: null, liveTrading: false };
  }

  const latest = strategy.trades[0];
  const requestedGrossEur = latest?.side === "buy"
    ? latest.grossEur
    : strategy.position.costEur / (1 + strategy.config.feePctEachSide);
  const decision = evaluateTreasuryEntry(strategy, stateBeforeEntry(strategy, state, snapshot), requestedGrossEur);

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
    const totalCostEur = approvedGrossEur + feeEur;
    if (totalCostEur > snapshot.cashEur) {
      restoreSnapshot(strategy, snapshot, "PAPER BUY vetada: saldo insuficiente para el presupuesto aprobado por Tesorería.");
      return { newEntryDetected: true, allowed: false, resized: false, decision, liveTrading: false };
    }
    const quantity = approvedGrossEur / latest.price;
    strategy.cashEur = money(snapshot.cashEur - totalCostEur);
    strategy.position = { ...strategy.position, quantity, costEur: totalCostEur };
    strategy.performance.totalFeesEur = money(snapshot.performance.totalFeesEur + feeEur);
    latest.quantity = quantity;
    latest.grossEur = approvedGrossEur;
    latest.feeEur = feeEur;
    latest.reason = `${latest.reason}. Tesorería única autorizó ${approvedGrossEur.toFixed(2)} €.`;
    strategy.equityEur = money(strategy.cashEur + quantity * latest.price);
  }

  strategy.lastDecision = `${strategy.lastDecision} Autorización Tesorería: ${approvedGrossEur.toFixed(2)} €; exposición previa ${decision.totalOpenExposureEur.toFixed(2)} €.`;
  return { newEntryDetected: true, allowed: true, resized: mustResize, decision, liveTrading: false };
}
