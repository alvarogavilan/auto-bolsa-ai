import type { PaperOperationDossier } from "./operation-dossier";

export interface PaperPatternMetrics {
  key: string;
  lane: PaperOperationDossier["lane"];
  symbol: string;
  entryReason: string;
  exitReason: string;
  sampleSize: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnlEur: number;
  averagePnlEur: number;
  averageLossEur: number;
  averageWinEur: number;
  totalCostsEur: number;
  averageDurationMinutes: number;
  profitFactor: number | null;
  negativeWithEvidence: boolean;
}

export interface PaperLossPatternForensics {
  schemaVersion: "paper-loss-pattern-forensics-v1";
  evidenceVersion: "paper-trade-evidence-v1";
  minimumSampleSize: number;
  analyzedClosedOperations: number;
  excludedLegacyOperations: number;
  patterns: PaperPatternMetrics[];
  negativePatterns: PaperPatternMetrics[];
  learningMayMutateParameters: false;
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizedReason(reason: string): string {
  return reason.trim().toLowerCase().replace(/\s+/g, " ") || "sin motivo";
}

export function buildPaperLossPatternForensics(
  operations: PaperOperationDossier[],
  minimumSampleSize = 5,
): PaperLossPatternForensics {
  const closed = operations.filter((operation) => operation.status === "closed" && operation.exit !== null);
  const evidenced = closed.filter((operation) => operation.entry.evidencePersisted && operation.exit!.evidencePersisted);
  const buckets = new Map<string, PaperOperationDossier[]>();

  for (const operation of evidenced) {
    const key = [
      operation.lane,
      operation.symbol,
      normalizedReason(operation.entry.reason),
      normalizedReason(operation.exit!.reason),
    ].join("|");
    const existing = buckets.get(key) ?? [];
    existing.push(operation);
    buckets.set(key, existing);
  }

  const patterns = [...buckets.entries()].map(([key, values]): PaperPatternMetrics => {
    const exits = values.map((value) => value.exit!);
    const wins = exits.filter((exit) => exit.netPnlEur > 0);
    const losses = exits.filter((exit) => exit.netPnlEur < 0);
    const grossProfit = wins.reduce((sum, exit) => sum + exit.netPnlEur, 0);
    const grossLoss = losses.reduce((sum, exit) => sum + Math.abs(exit.netPnlEur), 0);
    const sampleSize = values.length;
    const netPnlEur = exits.reduce((sum, exit) => sum + exit.netPnlEur, 0);
    const totalCostsEur = exits.reduce((sum, exit) => sum + exit.totalCostsEur, 0);
    const averageDurationMinutes = exits.reduce((sum, exit) => sum + exit.durationMinutes, 0) / sampleSize;
    const averageWinEur = wins.length > 0 ? grossProfit / wins.length : 0;
    const averageLossEur = losses.length > 0 ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
    const first = values[0]!;

    return {
      key,
      lane: first.lane,
      symbol: first.symbol,
      entryReason: first.entry.reason,
      exitReason: first.exit!.reason,
      sampleSize,
      wins: wins.length,
      losses: losses.length,
      winRatePct: money((wins.length / sampleSize) * 100),
      netPnlEur: money(netPnlEur),
      averagePnlEur: money(netPnlEur / sampleSize),
      averageLossEur: money(averageLossEur),
      averageWinEur: money(averageWinEur),
      totalCostsEur: money(totalCostsEur),
      averageDurationMinutes: money(averageDurationMinutes),
      profitFactor: profitFactor === null || !Number.isFinite(profitFactor) ? profitFactor : money(profitFactor),
      negativeWithEvidence: sampleSize >= minimumSampleSize && netPnlEur < 0 && (profitFactor ?? 0) < 1,
    };
  }).sort((left, right) => left.averagePnlEur - right.averagePnlEur || right.sampleSize - left.sampleSize);

  return {
    schemaVersion: "paper-loss-pattern-forensics-v1",
    evidenceVersion: "paper-trade-evidence-v1",
    minimumSampleSize,
    analyzedClosedOperations: evidenced.length,
    excludedLegacyOperations: closed.length - evidenced.length,
    patterns,
    negativePatterns: patterns.filter((pattern) => pattern.negativeWithEvidence),
    learningMayMutateParameters: false,
    liveTrading: false,
  };
}
