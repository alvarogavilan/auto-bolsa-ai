import type { LabStrategyState, ResearchLabState } from "./research-lab";

export interface PaperOpportunityDiagnostics {
  schemaVersion: "paper-opportunity-diagnostics-v2";
  generatedAt: number;
  strategiesObserved: number;
  activeStrategies: number;
  positionsOpen: number;
  positionsFlat: number;
  strategiesWithFreshAnalysis: number;
  strategiesOverdue: number;
  strategiesWithoutSuccessfulCycle: number;
  blockerCounts: Record<string, number>;
  blockersByStrategy: Array<{
    id: string;
    lane: string;
    symbol: string;
    positionOpen: boolean;
    lastDecision: string;
    lastSuccessfulAt: number | null;
    freshnessWindowMinutes: number;
    overdue: boolean;
  }>;
  liveTrading: false;
}

function classify(decision: string): string {
  const value = decision.toLowerCase();
  if (value.startsWith("paper buy")) return "entry-opened";
  if (value.startsWith("paper sell")) return "position-closed";
  if (value.includes("noticias")) return "news-veto";
  if (value.includes("gráfica")) return "chart-veto";
  if (value.includes("ejecución") || value.includes("profundidad")) return "execution-gate";
  if (value.includes("costes")) return "costs";
  if (value.includes("mínimo")) return "market-minimum";
  if (value.includes("cooldown")) return "cooldown";
  if (value.includes("confianza") || value.includes("ruptura") || value.includes("multitemporal")) return "technical-confirmation";
  if (value.includes("vela cerrada")) return "waiting-closed-candle";
  if (value.includes("drawdown")) return "risk-halt";
  if (value.startsWith("error")) return "runtime-error";
  if (value.includes("sin señal")) return "no-base-signal";
  return "other";
}

function freshnessWindowMs(strategy: LabStrategyState): number {
  // A strategy is considered healthy for one full expected interval plus a
  // scheduling/network grace period. This avoids falsely marking 60-minute
  // swing strategies as stale under the former fixed 20-minute threshold.
  const intervalMs = Math.max(1, strategy.config.intervalMinutes) * 60_000;
  const graceMs = Math.max(10 * 60_000, Math.min(30 * 60_000, intervalMs * 0.5));
  return intervalMs + graceMs;
}

function isOverdue(strategy: LabStrategyState, now: number): boolean {
  if (strategy.lastSuccessfulAt === null) return true;
  return now - strategy.lastSuccessfulAt > freshnessWindowMs(strategy);
}

export function buildPaperOpportunityDiagnostics(
  state: ResearchLabState,
  now = Date.now(),
): PaperOpportunityDiagnostics {
  const blockerCounts: Record<string, number> = {};
  const blockersByStrategy = state.strategies.map((strategy) => {
    const category = classify(strategy.lastDecision);
    blockerCounts[category] = (blockerCounts[category] ?? 0) + 1;
    const windowMs = freshnessWindowMs(strategy);
    return {
      id: strategy.id,
      lane: strategy.lane,
      symbol: strategy.symbol,
      positionOpen: strategy.position !== null,
      lastDecision: strategy.lastDecision,
      lastSuccessfulAt: strategy.lastSuccessfulAt,
      freshnessWindowMinutes: windowMs / 60_000,
      overdue: isOverdue(strategy, now),
    };
  });
  return {
    schemaVersion: "paper-opportunity-diagnostics-v2",
    generatedAt: now,
    strategiesObserved: state.strategies.length,
    activeStrategies: state.strategies.filter((strategy) => strategy.status === "active").length,
    positionsOpen: state.strategies.filter((strategy) => strategy.position !== null).length,
    positionsFlat: state.strategies.filter((strategy) => strategy.position === null).length,
    strategiesWithFreshAnalysis: state.strategies.filter((strategy) => !isOverdue(strategy, now)).length,
    strategiesOverdue: state.strategies.filter((strategy) => isOverdue(strategy, now)).length,
    strategiesWithoutSuccessfulCycle: state.strategies.filter((strategy) => strategy.lastSuccessfulAt === null).length,
    blockerCounts,
    blockersByStrategy,
    liveTrading: false,
  };
}
