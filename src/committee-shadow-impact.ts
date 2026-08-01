import type {
  CommitteeMemberVote,
  CommitteeVerdict,
  ResearchCommitteeReport,
} from "./decision-committee";
import type { LabStrategyState } from "./research-lab";

export interface CommitteeEntryEvaluation {
  schemaVersion: "committee-entry-evaluation-v1";
  entryTradeId: string;
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  entryAt: number;
  committeeCapturedAt: number;
  verdict: CommitteeVerdict | "unavailable";
  hardVetoCount: number;
  approvals: number;
  observations: number;
  vetoes: number;
  votes: CommitteeMemberVote[];
  exitTradeId: string | null;
  exitAt: number | null;
  pnlEur: number | null;
  outcome: "open" | "profit" | "loss" | "flat";
}

export interface CommitteeShadowImpactState {
  schemaVersion: "committee-shadow-impact-state-v1";
  initializedAt: number;
  updatedAt: number;
  seenTradeIds: string[];
  entries: CommitteeEntryEvaluation[];
  unmatchedExitTrades: number;
  changesTradingDecision: false;
  liveTrading: false;
}

export interface CommitteeShadowImpactReport {
  schemaVersion: "committee-shadow-impact-report-v1";
  generatedAt: number;
  entriesObserved: number;
  openEntries: number;
  closedEntries: number;
  hardVetoEntries: number;
  hardVetoClosedEntries: number;
  hardVetoLosses: number;
  hardVetoLossesAvoidedEur: number;
  hardVetoGains: number;
  hardVetoGainsMissedEur: number;
  hypotheticalHardVetoNetBenefitEur: number;
  candidateClosedEntries: number;
  candidateNetPnlEur: number;
  observeClosedEntries: number;
  observeNetPnlEur: number;
  unmatchedExitTrades: number;
  enoughEvidenceToConsiderAuthority: boolean;
  committeeAuthorityRecommended: false;
  interpretation: string;
  recentEntries: CommitteeEntryEvaluation[];
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

const MAX_ENTRIES = 500;
const MAX_SEEN_TRADE_IDS = 2_000;

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function emptyCommitteeShadowImpactState(now = Date.now()): CommitteeShadowImpactState {
  return {
    schemaVersion: "committee-shadow-impact-state-v1",
    initializedAt: now,
    updatedAt: now,
    seenTradeIds: [],
    entries: [],
    unmatchedExitTrades: 0,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

export function sanitizeCommitteeShadowImpactState(
  value: unknown,
  now = Date.now(),
): CommitteeShadowImpactState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyCommitteeShadowImpactState(now);
  }
  const candidate = value as Partial<CommitteeShadowImpactState>;
  if (candidate.schemaVersion !== "committee-shadow-impact-state-v1") {
    return emptyCommitteeShadowImpactState(now);
  }
  return {
    schemaVersion: "committee-shadow-impact-state-v1",
    initializedAt: typeof candidate.initializedAt === "number" ? candidate.initializedAt : now,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : now,
    seenTradeIds: Array.isArray(candidate.seenTradeIds)
      ? candidate.seenTradeIds.filter((item): item is string => typeof item === "string").slice(-MAX_SEEN_TRADE_IDS)
      : [],
    entries: Array.isArray(candidate.entries)
      ? candidate.entries.filter((item): item is CommitteeEntryEvaluation => Boolean(
          item
          && typeof item === "object"
          && (item as CommitteeEntryEvaluation).schemaVersion === "committee-entry-evaluation-v1"
          && typeof (item as CommitteeEntryEvaluation).entryTradeId === "string",
        )).slice(-MAX_ENTRIES)
      : [],
    unmatchedExitTrades: typeof candidate.unmatchedExitTrades === "number"
      ? Math.max(0, Math.trunc(candidate.unmatchedExitTrades))
      : 0,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

function reportMap(committee: ResearchCommitteeReport | null): Map<string, ResearchCommitteeReport["reports"][number]> {
  return new Map((committee?.reports ?? []).map((report) => [report.strategyId, report]));
}

function newEntry(
  strategy: LabStrategyState,
  trade: LabStrategyState["trades"][number],
  report: ResearchCommitteeReport["reports"][number] | null,
  capturedAt: number,
): CommitteeEntryEvaluation {
  return {
    schemaVersion: "committee-entry-evaluation-v1",
    entryTradeId: trade.id,
    strategyId: strategy.id,
    symbol: strategy.symbol,
    lane: strategy.lane,
    entryAt: trade.timestamp,
    committeeCapturedAt: capturedAt,
    verdict: report?.verdict ?? "unavailable",
    hardVetoCount: report?.hardVetoCount ?? 0,
    approvals: report?.approvals ?? 0,
    observations: report?.observations ?? 0,
    vetoes: report?.vetoes ?? 0,
    votes: report?.votes ?? [],
    exitTradeId: null,
    exitAt: null,
    pnlEur: null,
    outcome: "open",
  };
}

function closeEntry(
  entry: CommitteeEntryEvaluation,
  trade: LabStrategyState["trades"][number],
): CommitteeEntryEvaluation {
  const pnlEur = typeof trade.pnlEur === "number" && Number.isFinite(trade.pnlEur)
    ? round(trade.pnlEur)
    : 0;
  return {
    ...entry,
    exitTradeId: trade.id,
    exitAt: trade.timestamp,
    pnlEur,
    outcome: pnlEur > 0 ? "profit" : pnlEur < 0 ? "loss" : "flat",
  };
}

export function applyCommitteeTradeSnapshot(
  current: CommitteeShadowImpactState,
  strategies: LabStrategyState[],
  committee: ResearchCommitteeReport | null,
  now = Date.now(),
): CommitteeShadowImpactState {
  const state = sanitizeCommitteeShadowImpactState(current, now);
  const seen = new Set(state.seenTradeIds);
  let entries = [...state.entries];
  let unmatchedExitTrades = state.unmatchedExitTrades;
  const reports = reportMap(committee);

  for (const strategy of strategies) {
    const chronological = [...strategy.trades].sort((left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
    for (const trade of chronological) {
      if (seen.has(trade.id)) continue;
      seen.add(trade.id);
      if (trade.side === "buy") {
        entries.push(newEntry(strategy, trade, reports.get(strategy.id) ?? null, now));
        continue;
      }

      const openIndex = entries.findLastIndex((entry) =>
        entry.strategyId === strategy.id
        && entry.exitTradeId === null
        && entry.entryAt <= trade.timestamp,
      );
      if (openIndex < 0) {
        unmatchedExitTrades += 1;
        continue;
      }
      entries[openIndex] = closeEntry(entries[openIndex]!, trade);
    }
  }

  entries = entries
    .sort((left, right) => left.entryAt - right.entryAt || left.entryTradeId.localeCompare(right.entryTradeId))
    .slice(-MAX_ENTRIES);

  return {
    schemaVersion: "committee-shadow-impact-state-v1",
    initializedAt: state.initializedAt,
    updatedAt: now,
    seenTradeIds: [...seen].slice(-MAX_SEEN_TRADE_IDS),
    entries,
    unmatchedExitTrades,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

function sumPnl(entries: CommitteeEntryEvaluation[]): number {
  return round(entries.reduce((sum, entry) => sum + (entry.pnlEur ?? 0), 0));
}

export function buildCommitteeShadowImpactReport(
  value: CommitteeShadowImpactState,
  now = Date.now(),
): CommitteeShadowImpactReport {
  const state = sanitizeCommitteeShadowImpactState(value, now);
  const closed = state.entries.filter((entry) => entry.exitTradeId !== null && entry.pnlEur !== null);
  const hardVeto = state.entries.filter((entry) => entry.hardVetoCount > 0);
  const hardVetoClosed = hardVeto.filter((entry) => entry.exitTradeId !== null && entry.pnlEur !== null);
  const hardVetoLosses = hardVetoClosed.filter((entry) => (entry.pnlEur ?? 0) < 0);
  const hardVetoGains = hardVetoClosed.filter((entry) => (entry.pnlEur ?? 0) > 0);
  const candidateClosed = closed.filter((entry) => entry.verdict === "candidate");
  const observeClosed = closed.filter((entry) => entry.verdict === "observe" || entry.verdict === "unavailable");
  const avoided = round(hardVetoLosses.reduce((sum, entry) => sum + Math.abs(entry.pnlEur ?? 0), 0));
  const missed = round(hardVetoGains.reduce((sum, entry) => sum + Math.max(0, entry.pnlEur ?? 0), 0));
  const enoughEvidence = hardVetoClosed.length >= 20 && candidateClosed.length >= 20;

  return {
    schemaVersion: "committee-shadow-impact-report-v1",
    generatedAt: now,
    entriesObserved: state.entries.length,
    openEntries: state.entries.filter((entry) => entry.exitTradeId === null).length,
    closedEntries: closed.length,
    hardVetoEntries: hardVeto.length,
    hardVetoClosedEntries: hardVetoClosed.length,
    hardVetoLosses: hardVetoLosses.length,
    hardVetoLossesAvoidedEur: avoided,
    hardVetoGains: hardVetoGains.length,
    hardVetoGainsMissedEur: missed,
    hypotheticalHardVetoNetBenefitEur: round(avoided - missed),
    candidateClosedEntries: candidateClosed.length,
    candidateNetPnlEur: sumPnl(candidateClosed),
    observeClosedEntries: observeClosed.length,
    observeNetPnlEur: sumPnl(observeClosed),
    unmatchedExitTrades: state.unmatchedExitTrades,
    enoughEvidenceToConsiderAuthority: enoughEvidence,
    committeeAuthorityRecommended: false,
    interpretation: enoughEvidence
      ? "Existe una muestra inicial para revisión humana, pero el comité continúa en shadow y no recibe autoridad automática."
      : "La muestra causal todavía es insuficiente. El comité permanece exclusivamente en shadow.",
    recentEntries: [...state.entries].sort((left, right) => right.entryAt - left.entryAt).slice(0, 20),
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
