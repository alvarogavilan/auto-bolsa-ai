import type { LabStrategyState, ResearchLabState } from "./research-lab";

export interface TreasuryDecision {
  schemaVersion: "paper-treasury-risk-v1";
  allowed: boolean;
  maximumBudgetEur: number;
  maximumAllocationPct: number;
  totalOpenExposureEur: number;
  totalOpenExposurePct: number;
  reserveCashPct: number;
  reasons: string[];
  liveTrading: false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function evaluateTreasuryEntry(
  strategy: LabStrategyState,
  state: ResearchLabState | null,
  requestedBudgetEur: number,
): TreasuryDecision {
  const accountEquity = Math.max(0.01, strategy.equityEur || strategy.cashEur || 50);
  const peers = state?.strategies ?? [strategy];
  const openExposure = peers.reduce((sum, item) => sum + (item.position?.costEur ?? 0), 0);
  const aggregateReference = Math.max(50, peers.reduce((sum, item) => sum + Math.max(0, item.equityEur), 0));
  const openExposurePct = openExposure / aggregateReference;
  const reserveCashPct = 0.35;
  const laneCap = strategy.lane === "fast" ? 0.06 : strategy.lane === "intraday" ? 0.10 : 0.14;
  const drawdownPenalty = clamp(1 - strategy.maxDrawdownPct * 10, 0.35, 1);
  const recentSells = strategy.trades.filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number").slice(0, 10);
  const wins = recentSells.filter((trade) => (trade.pnlEur ?? 0) > 0).length;
  const evidencePenalty = recentSells.length >= 4 && wins === 0 ? 0.4 : recentSells.length >= 4 ? 0.8 : 0.65;
  const maximumAllocationPct = laneCap * drawdownPenalty * evidencePenalty;
  const reserveLimited = Math.max(0, strategy.cashEur - accountEquity * reserveCashPct);
  const maximumBudgetEur = Math.max(0, Math.min(requestedBudgetEur, accountEquity * maximumAllocationPct, reserveLimited));
  const reasons: string[] = [
    `Reserva mínima de efectivo ${(reserveCashPct * 100).toFixed(0)} %`,
    `Límite del carril ${(laneCap * 100).toFixed(1)} % antes de penalizaciones`,
    `Exposición PAPER agregada ${(openExposurePct * 100).toFixed(2)} %`,
  ];
  if (recentSells.length >= 4 && wins === 0) reasons.push("Penalización severa por ausencia de operaciones ganadoras recientes");
  if (strategy.maxDrawdownPct > 0.02) reasons.push("Penalización adicional por drawdown");
  const portfolioBlocked = openExposurePct >= 0.35;
  if (portfolioBlocked) reasons.push("Veto: exposición PAPER agregada igual o superior al 35 %");
  const allowed = !portfolioBlocked && maximumBudgetEur >= strategy.estimatedOrderMinimumEur;
  if (!allowed && maximumBudgetEur < strategy.estimatedOrderMinimumEur) reasons.push("Veto: presupuesto seguro inferior al mínimo del mercado");
  return {
    schemaVersion: "paper-treasury-risk-v1",
    allowed,
    maximumBudgetEur,
    maximumAllocationPct,
    totalOpenExposureEur: openExposure,
    totalOpenExposurePct: openExposurePct,
    reserveCashPct,
    reasons,
    liveTrading: false,
  };
}

export function buildTreasuryReport(state: ResearchLabState | null): Record<string, unknown> {
  const strategies = state?.strategies ?? [];
  const open = strategies.filter((strategy) => strategy.position !== null);
  const totalEquity = strategies.reduce((sum, strategy) => sum + Math.max(0, strategy.equityEur), 0);
  const totalExposure = open.reduce((sum, strategy) => sum + (strategy.position?.costEur ?? 0), 0);
  return {
    schemaVersion: "paper-treasury-department-v1",
    department: "Treasury & Portfolio Risk",
    openPositions: open.length,
    totalExposureEur: totalExposure,
    totalExposurePct: totalEquity > 0 ? totalExposure / totalEquity : 0,
    reserveCashPct: 0.35,
    maximumAggregateExposurePct: 0.35,
    confidenceNeverOverridesRiskLimits: true,
    largeUnboundedBetsAllowed: false,
    changesPaperDecision: true,
    liveTrading: false,
  };
}
