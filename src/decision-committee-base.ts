import type { FastEntryGate, LabStrategyState, ResearchLabState } from "./research-lab";
import type { PaperBenchmarkMap } from "./strategy-benchmark";

export type CommitteeVote = "approve" | "observe" | "veto";
export type CommitteeVerdict = "candidate" | "observe" | "vetoed";

export interface CommitteeMemberVote {
  id: "risk" | "execution" | "cost" | "evidence" | "benchmark" | "operations";
  role: string;
  vote: CommitteeVote;
  hardVeto: boolean;
  reason: string;
}

export interface StrategyCommitteeReport {
  schemaVersion: "paper-strategy-committee-v1";
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  generatedAt: number;
  verdict: CommitteeVerdict;
  confidence: "insufficient" | "developing" | "qualified";
  votes: CommitteeMemberVote[];
  hardVetoCount: number;
  approvals: number;
  observations: number;
  vetoes: number;
  message: string;
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export interface ResearchCommitteeReport {
  schemaVersion: "paper-research-committee-v1";
  generatedAt: number;
  strategyCount: number;
  candidates: number;
  observing: number;
  vetoed: number;
  reports: StrategyCommitteeReport[];
  methodology: string;
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

function profitFactor(strategy: LabStrategyState): number | null {
  const performance = strategy.performance;
  if (performance.grossLossEur > 0) return performance.grossProfitEur / performance.grossLossEur;
  return performance.grossProfitEur > 0 ? Number.POSITIVE_INFINITY : null;
}

function strategyReturnPct(strategy: LabStrategyState): number {
  if (strategy.initialCashEur <= 0) return 0;
  return ((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100;
}

function riskVote(strategy: LabStrategyState): CommitteeMemberVote {
  if (strategy.status !== "active") {
    return {
      id: "risk",
      role: "Riesgo",
      vote: "veto",
      hardVeto: true,
      reason: `La estrategia está ${strategy.status}; no puede promoverse mientras no vuelva a estar activa.`,
    };
  }
  if (strategy.maxDrawdownPct >= 0.05) {
    return {
      id: "risk",
      role: "Riesgo",
      vote: "veto",
      hardVeto: true,
      reason: "El drawdown alcanzó o superó el límite estructural del 5 %.",
    };
  }
  if (strategy.maxDrawdownPct <= 0.02) {
    return {
      id: "risk",
      role: "Riesgo",
      vote: "approve",
      hardVeto: false,
      reason: "El drawdown observado permanece dentro de la zona conservadora del 2 %.",
    };
  }
  return {
    id: "risk",
    role: "Riesgo",
    vote: "observe",
    hardVeto: false,
    reason: "El drawdown está controlado, pero todavía por encima de la zona conservadora del 2 %.",
  };
}

function executionVote(
  strategy: LabStrategyState,
  gates: Record<string, FastEntryGate>,
  now: number,
): CommitteeMemberVote {
  if (strategy.lane !== "fast") {
    return {
      id: "execution",
      role: "Ejecución",
      vote: "approve",
      hardVeto: false,
      reason: "Este carril no exige el veto de libro inmediato reservado a entradas rápidas.",
    };
  }
  const gate = gates[strategy.pairKey] ?? null;
  if (!gate) {
    return {
      id: "execution",
      role: "Ejecución",
      vote: "veto",
      hardVeto: true,
      reason: "No existe evidencia reciente de profundidad y coste para la entrada rápida.",
    };
  }
  if (now - gate.checkedAt > 10 * 60_000) {
    return {
      id: "execution",
      role: "Ejecución",
      vote: "veto",
      hardVeto: true,
      reason: "La evidencia del libro de órdenes está caducada.",
    };
  }
  if (!gate.allowed) {
    return {
      id: "execution",
      role: "Ejecución",
      vote: "veto",
      hardVeto: true,
      reason: `El libro de órdenes veta la entrada: ${gate.blocker ?? "coste o profundidad insuficientes"}.`,
    };
  }
  return {
    id: "execution",
    role: "Ejecución",
    vote: "approve",
    hardVeto: false,
    reason: "El libro reciente admite una entrada rápida del tamaño simulado.",
  };
}

function costVote(strategy: LabStrategyState): CommitteeMemberVote {
  const cost = strategy.estimatedTakerRoundTripCostPct;
  const target = strategy.config.takeProfitPct;
  if (!Number.isFinite(cost) || cost < 0) {
    return {
      id: "cost",
      role: "Costes",
      vote: "veto",
      hardVeto: true,
      reason: "No existe una estimación válida del coste de ida y vuelta.",
    };
  }
  if (cost >= target) {
    return {
      id: "cost",
      role: "Costes",
      vote: "veto",
      hardVeto: true,
      reason: "El coste estimado iguala o supera el objetivo bruto del carril.",
    };
  }
  if (cost <= target * 0.25) {
    return {
      id: "cost",
      role: "Costes",
      vote: "approve",
      hardVeto: false,
      reason: "El coste estimado consume como máximo una cuarta parte del objetivo bruto.",
    };
  }
  return {
    id: "cost",
    role: "Costes",
    vote: "observe",
    hardVeto: false,
    reason: "El coste no veta la estrategia, pero consume una parte relevante del objetivo.",
  };
}

function evidenceVote(strategy: LabStrategyState): CommitteeMemberVote {
  const closed = strategy.performance.closedTrades;
  const pf = profitFactor(strategy);
  if (closed < 30) {
    return {
      id: "evidence",
      role: "Evidencia",
      vote: "observe",
      hardVeto: false,
      reason: `Solo hay ${closed} operaciones cerradas; se exigen al menos 30 para una evaluación inicial.`,
    };
  }
  if (strategy.performance.netPnlEur > 0 && (pf ?? 0) >= 1.1) {
    return {
      id: "evidence",
      role: "Evidencia",
      vote: "approve",
      hardVeto: false,
      reason: "La muestra mínima, el resultado neto y el profit factor superan los umbrales PAPER.",
    };
  }
  return {
    id: "evidence",
    role: "Evidencia",
    vote: "veto",
    hardVeto: false,
    reason: "La muestra ya es evaluable, pero todavía no demuestra beneficio neto y profit factor suficiente.",
  };
}

function benchmarkVote(
  strategy: LabStrategyState,
  benchmarks: PaperBenchmarkMap,
): CommitteeMemberVote {
  const benchmark = benchmarks[strategy.id] ?? null;
  if (!benchmark || benchmark.observations < 30) {
    return {
      id: "benchmark",
      role: "Benchmark",
      vote: "observe",
      hardVeto: false,
      reason: "Todavía no hay suficientes observaciones comparables contra comprar y mantener.",
    };
  }
  const alpha = strategyReturnPct(strategy) - benchmark.netReturnPct;
  if (alpha > 0) {
    return {
      id: "benchmark",
      role: "Benchmark",
      vote: "approve",
      hardVeto: false,
      reason: "La estrategia supera comprar y mantener el mismo activo con la misma exposición y costes.",
    };
  }
  return {
    id: "benchmark",
    role: "Benchmark",
    vote: "veto",
    hardVeto: false,
    reason: "La estrategia no supera todavía la mejor referencia pasiva disponible para ese activo.",
  };
}

function operationsVote(strategy: LabStrategyState, now: number): CommitteeMemberVote {
  if (strategy.consecutiveErrors >= 3 || strategy.status === "error") {
    return {
      id: "operations",
      role: "Operaciones",
      vote: "veto",
      hardVeto: true,
      reason: "Existen errores consecutivos suficientes para aislar el carril.",
    };
  }
  if (strategy.lastSuccessfulAt === null) {
    return {
      id: "operations",
      role: "Operaciones",
      vote: "observe",
      hardVeto: false,
      reason: "El carril todavía no ha completado un ciclo correcto.",
    };
  }
  const staleAfter = Math.max(30, strategy.config.intervalMinutes * 3) * 60_000;
  if (now - strategy.lastSuccessfulAt > staleAfter) {
    return {
      id: "operations",
      role: "Operaciones",
      vote: "observe",
      hardVeto: false,
      reason: "El último ciclo correcto es más antiguo de lo esperado para este carril.",
    };
  }
  return {
    id: "operations",
    role: "Operaciones",
    vote: "approve",
    hardVeto: false,
    reason: "El carril está procesando ciclos correctamente y sin errores consecutivos.",
  };
}

export function buildStrategyCommittee(
  strategy: LabStrategyState,
  gates: Record<string, FastEntryGate>,
  benchmarks: PaperBenchmarkMap,
  now = Date.now(),
): StrategyCommitteeReport {
  const votes = [
    riskVote(strategy),
    executionVote(strategy, gates, now),
    costVote(strategy),
    evidenceVote(strategy),
    benchmarkVote(strategy, benchmarks),
    operationsVote(strategy, now),
  ];
  const hardVetoCount = votes.filter((vote) => vote.hardVeto && vote.vote === "veto").length;
  const approvals = votes.filter((vote) => vote.vote === "approve").length;
  const observations = votes.filter((vote) => vote.vote === "observe").length;
  const vetoes = votes.filter((vote) => vote.vote === "veto").length;
  const verdict: CommitteeVerdict = hardVetoCount > 0
    ? "vetoed"
    : approvals === votes.length ? "candidate" : "observe";
  const closed = strategy.performance.closedTrades;
  const confidence = closed >= 30 ? "qualified" : closed >= 10 ? "developing" : "insufficient";
  const message = verdict === "candidate"
    ? "Todos los miembros aprueban en shadow. Esto no autoriza trading real."
    : verdict === "vetoed"
      ? "Existe al menos un veto duro de seguridad, ejecución o costes."
      : "El comité continúa observando porque la evidencia o el benchmark aún no son concluyentes.";
  return {
    schemaVersion: "paper-strategy-committee-v1",
    strategyId: strategy.id,
    symbol: strategy.symbol,
    lane: strategy.lane,
    generatedAt: now,
    verdict,
    confidence,
    votes,
    hardVetoCount,
    approvals,
    observations,
    vetoes,
    message,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

export function buildResearchCommitteeReport(
  state: ResearchLabState,
  gates: Record<string, FastEntryGate>,
  benchmarks: PaperBenchmarkMap,
  now = Date.now(),
): ResearchCommitteeReport {
  const reports = state.strategies.map((strategy) => buildStrategyCommittee(strategy, gates, benchmarks, now));
  return {
    schemaVersion: "paper-research-committee-v1",
    generatedAt: now,
    strategyCount: reports.length,
    candidates: reports.filter((report) => report.verdict === "candidate").length,
    observing: reports.filter((report) => report.verdict === "observe").length,
    vetoed: reports.filter((report) => report.verdict === "vetoed").length,
    reports,
    methodology: "Comité determinista en shadow: riesgo, ejecución y costes conservan vetos duros; evidencia y benchmark no pueden promover una estrategia sin muestra suficiente.",
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
