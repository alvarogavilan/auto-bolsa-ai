import type { ResearchLabState } from "./research-lab";

export interface PaperOpportunityDiagnostics {
  schemaVersion: "paper-opportunity-diagnostics-v1";
  generatedAt: number;
  strategiesObserved: number;
  activeStrategies: number;
  positionsOpen: number;
  positionsFlat: number;
  strategiesWithFreshAnalysis: number;
  strategiesWithoutSuccessfulCycle: number;
  blockerCounts: Record<string, number>;
  blockersByStrategy: Array<{
    id: string;
    lane: string;
    symbol: string;
    positionOpen: boolean;
    lastDecision: string;
    lastSuccessfulAt: number | null;
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

export function buildPaperOpportunityDiagnostics(
  state: ResearchLabState,
  now = Date.now(),
): PaperOpportunityDiagnostics {
  const blockerCounts: Record<string, number> = {};
  const blockersByStrategy = state.strategies.map((strategy) => {
    const category = classify(strategy.lastDecision);
    blockerCounts[category] = (blockerCounts[category] ?? 0) + 1;
    return {
      id: strategy.id,
      lane: strategy.lane,
      symbol: strategy.symbol,
      positionOpen: strategy.position !== null,
      lastDecision: strategy.lastDecision,
      lastSuccessfulAt: strategy.lastSuccessfulAt,
    };
  });
  return {
    schemaVersion: "paper-opportunity-diagnostics-v1",
    generatedAt: now,
    strategiesObserved: state.strategies.length,
    activeStrategies: state.strategies.filter((strategy) => strategy.status === "active").length,
    positionsOpen: state.strategies.filter((strategy) => strategy.position !== null).length,
    positionsFlat: state.strategies.filter((strategy) => strategy.position === null).length,
    strategiesWithFreshAnalysis: state.strategies.filter((strategy) => strategy.lastSuccessfulAt !== null && now - strategy.lastSuccessfulAt <= 20 * 60_000).length,
    strategiesWithoutSuccessfulCycle: state.strategies.filter((strategy) => strategy.lastSuccessfulAt === null).length,
    blockerCounts,
    blockersByStrategy,
    liveTrading: false,
  };
}
