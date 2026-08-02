import type { LabStrategyState, ResearchLabState } from "./research-lab";

export const PAPER_OPERATIONAL_BANKROLL_EUR = 100;
export const PAPER_RESERVE_CASH_PCT = 0.35;
export const PAPER_MAXIMUM_AGGREGATE_EXPOSURE_PCT = 0.35;
export const PAPER_LANE_BUDGET_EUR = {
  fast: 5,
  intraday: 7.5,
  swing: 10,
} as const;

export interface PaperTreasurySnapshot {
  schemaVersion: "paper-operational-treasury-v1";
  initialBankrollEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  equityEur: number;
  committedCapitalEur: number;
  freeCashEur: number;
  reserveCashEur: number;
  allocatableCashEur: number;
  openPositions: number;
  maximumAggregateExposureEur: number;
  overAllocated: boolean;
  benchmarkStrategiesAreComparableNotAdditive: true;
  liveTrading: false;
}

export interface TreasuryDecision {
  schemaVersion: "paper-treasury-risk-v2";
  allowed: boolean;
  requestedBudgetEur: number;
  targetBudgetEur: number;
  maximumBudgetEur: number;
  totalOpenExposureEur: number;
  totalOpenExposurePct: number;
  reserveCashPct: number;
  reasons: string[];
  snapshot: PaperTreasurySnapshot;
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function realizedPnl(strategies: LabStrategyState[]): number {
  return strategies.reduce(
    (total, strategy) => total + strategy.trades.reduce(
      (sum, trade) => sum + (trade.side === "sell" && typeof trade.pnlEur === "number" ? trade.pnlEur : 0),
      0,
    ),
    0,
  );
}

function unrealizedPnl(strategies: LabStrategyState[]): number {
  return strategies.reduce((total, strategy) => {
    if (!strategy.position) return total;
    const markedPositionValue = Math.max(0, strategy.equityEur - strategy.cashEur);
    return total + markedPositionValue - strategy.position.costEur;
  }, 0);
}

export function buildPaperTreasurySnapshot(state: ResearchLabState | null): PaperTreasurySnapshot {
  const strategies = state?.strategies ?? [];
  const open = strategies.filter((strategy) => strategy.position !== null);
  const realizedPnlEur = money(realizedPnl(strategies));
  const unrealizedPnlEur = money(unrealizedPnl(strategies));
  const equityEur = money(Math.max(0, PAPER_OPERATIONAL_BANKROLL_EUR + realizedPnlEur + unrealizedPnlEur));
  const committedCapitalEur = money(open.reduce((sum, strategy) => sum + (strategy.position?.costEur ?? 0), 0));
  const reserveCashEur = money(equityEur * PAPER_RESERVE_CASH_PCT);
  const maximumAggregateExposureEur = money(equityEur * PAPER_MAXIMUM_AGGREGATE_EXPOSURE_PCT);
  const freeCashEur = money(Math.max(0, equityEur - committedCapitalEur));
  const allocatableCashEur = money(Math.max(
    0,
    Math.min(freeCashEur - reserveCashEur, maximumAggregateExposureEur - committedCapitalEur),
  ));

  return {
    schemaVersion: "paper-operational-treasury-v1",
    initialBankrollEur: PAPER_OPERATIONAL_BANKROLL_EUR,
    realizedPnlEur,
    unrealizedPnlEur,
    equityEur,
    committedCapitalEur,
    freeCashEur,
    reserveCashEur,
    allocatableCashEur,
    openPositions: open.length,
    maximumAggregateExposureEur,
    overAllocated: committedCapitalEur > maximumAggregateExposureEur || committedCapitalEur > equityEur - reserveCashEur,
    benchmarkStrategiesAreComparableNotAdditive: true,
    liveTrading: false,
  };
}

export function evaluateTreasuryEntry(
  strategy: LabStrategyState,
  state: ResearchLabState | null,
  requestedBudgetEur: number,
): TreasuryDecision {
  const snapshot = buildPaperTreasurySnapshot(state);
  const targetBudgetEur = PAPER_LANE_BUDGET_EUR[strategy.lane];
  const normalizedRequest = money(Math.max(0, Math.min(requestedBudgetEur, targetBudgetEur)));
  const maximumBudgetEur = snapshot.allocatableCashEur >= normalizedRequest ? normalizedRequest : 0;
  const reasons: string[] = [
    `Banca PAPER operativa única: ${PAPER_OPERATIONAL_BANKROLL_EUR.toFixed(2)} €`,
    `Reserva mínima de efectivo ${(PAPER_RESERVE_CASH_PCT * 100).toFixed(0)} %`,
    `Exposición máxima agregada ${(PAPER_MAXIMUM_AGGREGATE_EXPOSURE_PCT * 100).toFixed(0)} %`,
    `Asignación objetivo del carril: ${targetBudgetEur.toFixed(2)} €`,
    `Capital comprometido: ${snapshot.committedCapitalEur.toFixed(2)} €`,
    `Capital todavía asignable: ${snapshot.allocatableCashEur.toFixed(2)} €`,
  ];

  if (snapshot.overAllocated) reasons.push("Veto: la exposición existente ya supera el límite de Tesorería");
  if (normalizedRequest < 5) reasons.push("Veto: no se permiten nuevas posiciones testimoniales inferiores a 5 €");
  if (normalizedRequest < strategy.estimatedOrderMinimumEur) reasons.push("Veto: el presupuesto objetivo no cubre el mínimo del mercado");
  if (snapshot.allocatableCashEur < normalizedRequest) reasons.push("Veto: la banca única no dispone de capital asignable suficiente");
  if (strategy.maxDrawdownPct >= 0.05) reasons.push("Veto: estrategia detenida por drawdown máximo");

  const allowed = !snapshot.overAllocated
    && normalizedRequest >= 5
    && normalizedRequest >= strategy.estimatedOrderMinimumEur
    && snapshot.allocatableCashEur >= normalizedRequest
    && strategy.maxDrawdownPct < 0.05;

  return {
    schemaVersion: "paper-treasury-risk-v2",
    allowed,
    requestedBudgetEur: money(requestedBudgetEur),
    targetBudgetEur,
    maximumBudgetEur: allowed ? maximumBudgetEur : 0,
    totalOpenExposureEur: snapshot.committedCapitalEur,
    totalOpenExposurePct: snapshot.equityEur > 0 ? snapshot.committedCapitalEur / snapshot.equityEur : 0,
    reserveCashPct: PAPER_RESERVE_CASH_PCT,
    reasons,
    snapshot,
    liveTrading: false,
  };
}

export function buildTreasuryReport(state: ResearchLabState | null): Record<string, unknown> {
  const snapshot = buildPaperTreasurySnapshot(state);
  const { schemaVersion: snapshotSchemaVersion, ...snapshotValues } = snapshot;
  return {
    schemaVersion: "paper-treasury-department-v2",
    snapshotSchemaVersion,
    department: "Tesorería PAPER única",
    ...snapshotValues,
    reserveCashPct: PAPER_RESERVE_CASH_PCT,
    maximumAggregateExposurePct: PAPER_MAXIMUM_AGGREGATE_EXPOSURE_PCT,
    laneBudgetsEur: PAPER_LANE_BUDGET_EUR,
    singleSourceOfTruth: true,
    strategyBalancesAreBenchmarkOnly: true,
    confidenceNeverOverridesRiskLimits: true,
    largeUnboundedBetsAllowed: false,
    changesPaperDecision: true,
    liveTrading: false,
  };
}
