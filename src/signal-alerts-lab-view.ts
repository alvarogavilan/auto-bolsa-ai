import { summarizeStrategy, type LabPosition, type LabTrade, type ResearchLabState } from "./research-lab";

/**
 * Vista mínima del laboratorio crypto para el motor de alertas.
 * Evita leer el `/status` completo (muy pesado) en cada ciclo.
 */
export interface LabAlertStrategyView {
  id: string;
  lane: string;
  pairKey: string;
  symbol: string;
  base: string;
  status: string;
  position: LabPosition | null;
  recentTrades: LabTrade[];
  closedTrades: number;
  netPnlEur: number;
  winRatePct: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number;
  eligibleForHumanReview: boolean;
}

export interface LabAlertView {
  schemaVersion: "lab-alert-view-v1";
  initialized: boolean;
  observedAt: number;
  strategies: LabAlertStrategyView[];
}

export function buildLabAlertView(state: ResearchLabState | null, now: number): LabAlertView {
  if (!state) return { schemaVersion: "lab-alert-view-v1", initialized: false, observedAt: now, strategies: [] };
  const strategies = state.strategies.map((strategy) => {
    const summary = summarizeStrategy(strategy, now, state.initializedAt);
    return {
      id: strategy.id,
      lane: strategy.lane,
      pairKey: strategy.pairKey,
      symbol: strategy.symbol,
      base: strategy.base,
      status: strategy.status,
      position: strategy.position,
      recentTrades: strategy.trades.slice(0, 4),
      closedTrades: summary.closedTrades,
      netPnlEur: strategy.performance.netPnlEur,
      winRatePct: summary.winRatePct,
      profitFactor: Number.isFinite(summary.profitFactor ?? Number.NaN) ? summary.profitFactor : null,
      maxDrawdownPct: summary.maxDrawdownPct,
      eligibleForHumanReview: summary.eligibleForHumanReview,
    };
  });
  return { schemaVersion: "lab-alert-view-v1", initialized: true, observedAt: now, strategies };
}
