import type { LabStrategyState, ResearchLabState } from "./research-lab";

export interface PaperOpportunityAuditMetrics {
  signalsAnalyzed: number;
  signalsValid: number;
  rejectedBySpread: number;
  rejectedByRisk: number;
  rejectedByLiquidity: number;
  rejectedByNews: number;
  rejectedByCommittee: number;
  rejectedByExposure: number;
  rejectedByMarketMinimum: number;
  rejectedByExecution: number;
  rejectedByTechnicalConfirmation: number;
  rejectedWithoutBaseSignal: number;
  operationsOpened: number;
  currentSnapshotOnly: true;
}

export interface PaperOpportunityDiagnostics {
  schemaVersion: "paper-opportunity-diagnostics-v4";
  generatedAt: number;
  strategiesObserved: number;
  activeStrategies: number;
  positionsOpen: number;
  positionsFlat: number;
  strategiesWithFreshAnalysis: number;
  strategiesOverdue: number;
  strategiesWithoutSuccessfulCycle: number;
  healthyFlatStrategies: number;
  overdueFlatStrategies: number;
  dominantBlocker: string | null;
  dominantBlockerCount: number;
  operationalStatus: "positions-open" | "flat-healthy" | "flat-runtime-delayed" | "flat-no-successful-cycles";
  operationalExplanation: string;
  blockerCounts: Record<string, number>;
  auditMetrics: PaperOpportunityAuditMetrics;
  auditInterpretation: string;
  blockersByStrategy: Array<{
    id: string;
    lane: string;
    symbol: string;
    positionOpen: boolean;
    blockerCategory: string | null;
    lastDecision: string;
    lastSuccessfulAt: number | null;
    freshnessWindowMinutes: number;
    overdue: boolean;
  }>;
  liveTrading: false;
}

function classify(decision: string): string {
  const value = decision.toLowerCase();
  if (value.includes("spread")) return "spread";
  if (value.includes("liquidez") || value.includes("profundidad")) return "liquidity";
  if (value.includes("noticias") || value.includes("informativo")) return "news-veto";
  if (value.includes("comité")) return "committee-veto";
  if (value.includes("tesorería") || value.includes("exposición") || value.includes("capital asignable")) return "exposure-veto";
  if (value.includes("drawdown") || value.includes("riesgo")) return "risk-halt";
  if (value.includes("ejecución")) return "execution-gate";
  if (value.includes("costes")) return "costs";
  if (value.includes("mínimo")) return "market-minimum";
  if (value.includes("cooldown")) return "cooldown";
  if (value.includes("confianza") || value.includes("ruptura") || value.includes("multitemporal") || value.includes("gráfica")) return "technical-confirmation";
  if (value.includes("vela cerrada")) return "waiting-closed-candle";
  if (value.startsWith("error")) return "runtime-error";
  if (value.includes("sin señal")) return "no-base-signal";
  return "other";
}

function freshnessWindowMs(strategy: LabStrategyState): number {
  const intervalMs = Math.max(1, strategy.config.intervalMinutes) * 60_000;
  const graceMs = Math.max(10 * 60_000, Math.min(30 * 60_000, intervalMs * 0.5));
  return intervalMs + graceMs;
}

function isOverdue(strategy: LabStrategyState, now: number): boolean {
  if (strategy.lastSuccessfulAt === null) return true;
  return now - strategy.lastSuccessfulAt > freshnessWindowMs(strategy);
}

function dominantBlocker(blockerCounts: Record<string, number>): { category: string | null; count: number } {
  const ordered = Object.entries(blockerCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const first = ordered[0];
  return first ? { category: first[0], count: first[1] } : { category: null, count: 0 };
}

function explainOperationalStatus(
  positionsOpen: number,
  flatStrategies: number,
  healthyFlatStrategies: number,
  overdueFlatStrategies: number,
  withoutSuccessfulCycle: number,
  blocker: { category: string | null; count: number },
): { status: PaperOpportunityDiagnostics["operationalStatus"]; explanation: string } {
  if (positionsOpen > 0) {
    return { status: "positions-open", explanation: `${positionsOpen} posición(es) PAPER abierta(s); ${flatStrategies} estrategia(s) continúan buscando oportunidades.` };
  }
  if (flatStrategies > 0 && withoutSuccessfulCycle === flatStrategies) {
    return { status: "flat-no-successful-cycles", explanation: `Las ${flatStrategies} estrategias están planas y todavía no han completado ningún ciclo correcto.` };
  }
  if (overdueFlatStrategies > 0 && healthyFlatStrategies === 0) {
    return { status: "flat-runtime-delayed", explanation: `No hay posiciones y las ${overdueFlatStrategies} estrategias planas están fuera de su ventana normal de actualización.` };
  }
  const blockerText = blocker.category === null ? "sin un bloqueo dominante identificado" : `con bloqueo dominante ${blocker.category} en ${blocker.count} estrategia(s)`;
  return { status: "flat-healthy", explanation: `No hay posiciones abiertas, pero ${healthyFlatStrategies} estrategia(s) planas tienen análisis vigente, ${blockerText}.` };
}

function count(blockerCounts: Record<string, number>, ...categories: string[]): number {
  return categories.reduce((sum, category) => sum + (blockerCounts[category] ?? 0), 0);
}

function buildAuditMetrics(state: ResearchLabState, blockerCounts: Record<string, number>): PaperOpportunityAuditMetrics {
  return {
    signalsAnalyzed: state.strategies.reduce((sum, strategy) => sum + Math.max(strategy.cycles, strategy.uniqueCandles), 0),
    signalsValid: state.strategies.reduce((sum, strategy) => sum + strategy.performance.buys, 0),
    rejectedBySpread: count(blockerCounts, "spread"),
    rejectedByRisk: count(blockerCounts, "risk-halt"),
    rejectedByLiquidity: count(blockerCounts, "liquidity"),
    rejectedByNews: count(blockerCounts, "news-veto"),
    rejectedByCommittee: count(blockerCounts, "committee-veto"),
    rejectedByExposure: count(blockerCounts, "exposure-veto"),
    rejectedByMarketMinimum: count(blockerCounts, "market-minimum"),
    rejectedByExecution: count(blockerCounts, "execution-gate", "costs"),
    rejectedByTechnicalConfirmation: count(blockerCounts, "technical-confirmation", "waiting-closed-candle", "cooldown"),
    rejectedWithoutBaseSignal: count(blockerCounts, "no-base-signal"),
    operationsOpened: state.strategies.reduce((sum, strategy) => sum + strategy.performance.buys, 0),
    currentSnapshotOnly: true,
  };
}

export function buildPaperOpportunityDiagnostics(state: ResearchLabState, now = Date.now()): PaperOpportunityDiagnostics {
  const blockerCounts: Record<string, number> = {};
  const blockersByStrategy = state.strategies.map((strategy) => {
    const overdue = isOverdue(strategy, now);
    const positionOpen = strategy.position !== null;
    const blockerCategory = positionOpen ? null : classify(strategy.lastDecision);
    if (blockerCategory !== null) blockerCounts[blockerCategory] = (blockerCounts[blockerCategory] ?? 0) + 1;
    const windowMs = freshnessWindowMs(strategy);
    return {
      id: strategy.id,
      lane: strategy.lane,
      symbol: strategy.symbol,
      positionOpen,
      blockerCategory,
      lastDecision: strategy.lastDecision,
      lastSuccessfulAt: strategy.lastSuccessfulAt,
      freshnessWindowMinutes: windowMs / 60_000,
      overdue,
    };
  });
  const positionsOpen = state.strategies.filter((strategy) => strategy.position !== null).length;
  const positionsFlat = state.strategies.length - positionsOpen;
  const healthyFlatStrategies = state.strategies.filter((strategy) => strategy.position === null && !isOverdue(strategy, now)).length;
  const overdueFlatStrategies = state.strategies.filter((strategy) => strategy.position === null && isOverdue(strategy, now)).length;
  const strategiesWithoutSuccessfulCycle = state.strategies.filter((strategy) => strategy.lastSuccessfulAt === null).length;
  const dominant = dominantBlocker(blockerCounts);
  const operational = explainOperationalStatus(positionsOpen, positionsFlat, healthyFlatStrategies, overdueFlatStrategies, strategiesWithoutSuccessfulCycle, dominant);
  return {
    schemaVersion: "paper-opportunity-diagnostics-v4",
    generatedAt: now,
    strategiesObserved: state.strategies.length,
    activeStrategies: state.strategies.filter((strategy) => strategy.status === "active").length,
    positionsOpen,
    positionsFlat,
    strategiesWithFreshAnalysis: state.strategies.filter((strategy) => !isOverdue(strategy, now)).length,
    strategiesOverdue: state.strategies.filter((strategy) => isOverdue(strategy, now)).length,
    strategiesWithoutSuccessfulCycle,
    healthyFlatStrategies,
    overdueFlatStrategies,
    dominantBlocker: dominant.category,
    dominantBlockerCount: dominant.count,
    operationalStatus: operational.status,
    operationalExplanation: operational.explanation,
    blockerCounts,
    auditMetrics: buildAuditMetrics(state, blockerCounts),
    auditInterpretation: "Los contadores acumulados de análisis y aperturas proceden del estado persistido. Los descartes por motivo representan el bloqueo actual de cada estrategia y no se presentan como un histórico acumulado.",
    blockersByStrategy,
    liveTrading: false,
  };
}
