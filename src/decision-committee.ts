import {
  buildStrategyCommittee as buildBaseStrategyCommittee,
  type CommitteeMemberVote,
  type StrategyCommitteeReport,
} from "./decision-committee-base";
import type { FastEntryGate, LabStrategyState, ResearchLabState } from "./research-lab";
import type { PaperBenchmarkMap } from "./strategy-benchmark";

export type {
  CommitteeMemberVote,
  CommitteeVerdict,
  CommitteeVote,
  ResearchCommitteeReport,
  StrategyCommitteeReport,
} from "./decision-committee-base";

function strategyReturnPct(strategy: LabStrategyState): number {
  if (!Number.isFinite(strategy.initialCashEur) || strategy.initialCashEur <= 0) return 0;
  return ((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100;
}

function correctedBenchmarkVote(
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
      reason: "Todavía no hay suficientes observaciones comparables contra efectivo y comprar y mantener.",
    };
  }

  const bestPassiveReturnPct = Math.max(0, benchmark.netReturnPct);
  const alphaPct = strategyReturnPct(strategy) - bestPassiveReturnPct;
  if (alphaPct > 0) {
    return {
      id: "benchmark",
      role: "Benchmark",
      vote: "approve",
      hardVeto: false,
      reason: "La estrategia supera tanto conservar efectivo como comprar y mantener el mismo activo con costes.",
    };
  }
  return {
    id: "benchmark",
    role: "Benchmark",
    vote: "veto",
    hardVeto: false,
    reason: "La estrategia no supera todavía la mejor alternativa pasiva entre efectivo y comprar y mantener.",
  };
}

function recalculateReport(
  report: StrategyCommitteeReport,
  strategy: LabStrategyState,
  benchmarks: PaperBenchmarkMap,
): StrategyCommitteeReport {
  const benchmarkVote = correctedBenchmarkVote(strategy, benchmarks);
  const votes = report.votes.map((vote) => vote.id === "benchmark" ? benchmarkVote : vote);
  const hardVetoCount = votes.filter((vote) => vote.hardVeto && vote.vote === "veto").length;
  const approvals = votes.filter((vote) => vote.vote === "approve").length;
  const observations = votes.filter((vote) => vote.vote === "observe").length;
  const vetoes = votes.filter((vote) => vote.vote === "veto").length;
  const verdict = hardVetoCount > 0
    ? "vetoed" as const
    : approvals === votes.length ? "candidate" as const : "observe" as const;
  const message = verdict === "candidate"
    ? "Todos los miembros aprueban en shadow. Esto no autoriza trading real."
    : verdict === "vetoed"
      ? "Existe al menos un veto duro de seguridad, ejecución o costes."
      : "El comité continúa observando porque la evidencia o el benchmark aún no son concluyentes.";

  return {
    ...report,
    verdict,
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

export function buildStrategyCommittee(
  strategy: LabStrategyState,
  gates: Record<string, FastEntryGate>,
  benchmarks: PaperBenchmarkMap,
  now = Date.now(),
): StrategyCommitteeReport {
  return recalculateReport(
    buildBaseStrategyCommittee(strategy, gates, benchmarks, now),
    strategy,
    benchmarks,
  );
}

export function buildResearchCommitteeReport(
  state: ResearchLabState,
  gates: Record<string, FastEntryGate>,
  benchmarks: PaperBenchmarkMap,
  now = Date.now(),
) {
  const reports = state.strategies.map((strategy) => buildStrategyCommittee(strategy, gates, benchmarks, now));
  return {
    schemaVersion: "paper-research-committee-v1" as const,
    generatedAt: now,
    strategyCount: reports.length,
    candidates: reports.filter((report) => report.verdict === "candidate").length,
    observing: reports.filter((report) => report.verdict === "observe").length,
    vetoed: reports.filter((report) => report.verdict === "vetoed").length,
    reports,
    methodology: "Comité determinista en shadow: riesgo, ejecución y costes conservan vetos duros; evidencia y benchmark exigen muestra suficiente y superar la mejor alternativa pasiva entre efectivo y comprar y mantener.",
    changesTradingDecision: false as const,
    eligibleForLiveReview: false as const,
    liveTrading: false as const,
  };
}
