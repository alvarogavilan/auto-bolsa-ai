import { buildOperationDossiers } from "./operation-dossier";
import type { LabStrategyState, LabTrade, ResearchLabState } from "./research-lab";

export const MIN_NEGATIVE_PATTERN_SAMPLE = 5;
export const EARLY_NEGATIVE_PATTERN_LOSS_STREAK = 3;

export interface NegativePatternVeto {
  blocked: boolean;
  trigger: "none" | "early-loss-streak" | "statistical-negative-pattern";
  sampleSize: number;
  consecutiveLosses: number;
  netPnlEur: number;
  profitFactor: number | null;
  lane: LabStrategyState["lane"];
  symbol: string;
  entryReason: string;
  liveTrading: false;
}

function normalizedReason(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ") || "sin motivo";
}

export function evaluateNegativePatternVeto(
  strategy: LabStrategyState,
  stateBeforeEntry: ResearchLabState,
  latestEntry: LabTrade | undefined,
): NegativePatternVeto {
  const entryReason = normalizedReason(latestEntry?.reason ?? "");
  if (!latestEntry || latestEntry.side !== "buy") {
    return {
      blocked: false,
      trigger: "none",
      sampleSize: 0,
      consecutiveLosses: 0,
      netPnlEur: 0,
      profitFactor: null,
      lane: strategy.lane,
      symbol: strategy.symbol,
      entryReason,
      liveTrading: false,
    };
  }

  const report = buildOperationDossiers(stateBeforeEntry.strategies);
  const matching = report.operations.filter((operation) => (
    operation.status === "closed"
    && operation.exit !== null
    && operation.entry.evidencePersisted
    && operation.exit.evidencePersisted
    && operation.lane === strategy.lane
    && operation.symbol === strategy.symbol
    && normalizedReason(operation.entry.reason) === entryReason
  ));
  const exits = matching.map((operation) => operation.exit!);
  const grossProfit = exits.filter((exit) => exit.netPnlEur > 0).reduce((sum, exit) => sum + exit.netPnlEur, 0);
  const grossLoss = exits.filter((exit) => exit.netPnlEur < 0).reduce((sum, exit) => sum + Math.abs(exit.netPnlEur), 0);
  const netPnlEur = exits.reduce((sum, exit) => sum + exit.netPnlEur, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
  const chronological = [...matching].sort((left, right) => (right.exit?.timestamp ?? 0) - (left.exit?.timestamp ?? 0));
  let consecutiveLosses = 0;
  for (const operation of chronological) {
    if ((operation.exit?.netPnlEur ?? 0) >= 0) break;
    consecutiveLosses += 1;
  }

  const earlyLossStreak = consecutiveLosses >= EARLY_NEGATIVE_PATTERN_LOSS_STREAK;
  const statisticalNegativePattern = matching.length >= MIN_NEGATIVE_PATTERN_SAMPLE
    && netPnlEur < 0
    && (profitFactor ?? 0) < 1;
  const trigger = statisticalNegativePattern
    ? "statistical-negative-pattern"
    : earlyLossStreak ? "early-loss-streak" : "none";

  return {
    blocked: trigger !== "none",
    trigger,
    sampleSize: matching.length,
    consecutiveLosses,
    netPnlEur: Math.round(netPnlEur * 1_000_000) / 1_000_000,
    profitFactor: profitFactor === null || !Number.isFinite(profitFactor)
      ? profitFactor
      : Math.round(profitFactor * 1_000_000) / 1_000_000,
    lane: strategy.lane,
    symbol: strategy.symbol,
    entryReason: latestEntry.reason,
    liveTrading: false,
  };
}
