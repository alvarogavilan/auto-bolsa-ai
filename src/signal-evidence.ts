export type RawSignalAction = "buy" | "sell" | "hold";

export type SignalOutcome =
  | "buy-executed"
  | "sell-executed"
  | "hold"
  | "risk-blocked"
  | "cooldown-blocked"
  | "stop-loss-executed"
  | "take-profit-executed";

export interface SignalEvidenceEntry {
  schemaVersion: "paper-signal-evidence-v1";
  candleTime: number;
  recordedAt: number;
  price: number;
  fastEma: number;
  slowEma: number;
  previousFastEma: number;
  previousSlowEma: number;
  rsi: number;
  rawSignal: RawSignalAction;
  rawReason: string;
  outcome: SignalOutcome;
  finalReason: string;
  hadPositionBefore: boolean;
  hasPositionAfter: boolean;
  equityEur: number;
  cashEur: number;
}

export interface SignalEvidenceStats {
  uniqueCandlesRecorded: number;
  rawBuySignals: number;
  rawSellSignals: number;
  rawHoldSignals: number;
  buysExecuted: number;
  sellsExecuted: number;
  stopLossesExecuted: number;
  takeProfitsExecuted: number;
  riskBlocks: number;
  cooldownBlocks: number;
  holds: number;
}

export interface SignalEvidenceLedger {
  schemaVersion: "paper-signal-ledger-v1";
  retentionEntries: number;
  stats: SignalEvidenceStats;
  entries: SignalEvidenceEntry[];
}

export const SIGNAL_EVIDENCE_RETENTION = 500;

export function emptySignalEvidenceLedger(): SignalEvidenceLedger {
  return {
    schemaVersion: "paper-signal-ledger-v1",
    retentionEntries: SIGNAL_EVIDENCE_RETENTION,
    stats: {
      uniqueCandlesRecorded: 0,
      rawBuySignals: 0,
      rawSellSignals: 0,
      rawHoldSignals: 0,
      buysExecuted: 0,
      sellsExecuted: 0,
      stopLossesExecuted: 0,
      takeProfitsExecuted: 0,
      riskBlocks: 0,
      cooldownBlocks: 0,
      holds: 0,
    },
    entries: [],
  };
}

export function appendSignalEvidence(
  current: SignalEvidenceLedger | null,
  entry: SignalEvidenceEntry,
): SignalEvidenceLedger {
  const ledger = current ?? emptySignalEvidenceLedger();
  const stats = { ...ledger.stats };

  stats.uniqueCandlesRecorded += 1;
  if (entry.rawSignal === "buy") stats.rawBuySignals += 1;
  else if (entry.rawSignal === "sell") stats.rawSellSignals += 1;
  else stats.rawHoldSignals += 1;

  switch (entry.outcome) {
    case "buy-executed":
      stats.buysExecuted += 1;
      break;
    case "sell-executed":
      stats.sellsExecuted += 1;
      break;
    case "stop-loss-executed":
      stats.sellsExecuted += 1;
      stats.stopLossesExecuted += 1;
      break;
    case "take-profit-executed":
      stats.sellsExecuted += 1;
      stats.takeProfitsExecuted += 1;
      break;
    case "risk-blocked":
      stats.riskBlocks += 1;
      break;
    case "cooldown-blocked":
      stats.cooldownBlocks += 1;
      break;
    case "hold":
      stats.holds += 1;
      break;
  }

  return {
    schemaVersion: "paper-signal-ledger-v1",
    retentionEntries: SIGNAL_EVIDENCE_RETENTION,
    stats,
    entries: [entry, ...ledger.entries].slice(0, SIGNAL_EVIDENCE_RETENTION),
  };
}

export function summarizeSignalEvidence(ledger: SignalEvidenceLedger): Record<string, unknown> {
  const latest = ledger.entries[0] ?? null;
  return {
    schemaVersion: ledger.schemaVersion,
    retentionEntries: ledger.retentionEntries,
    retainedEntries: ledger.entries.length,
    stats: ledger.stats,
    latestCandleTime: latest?.candleTime ?? null,
    latestRawSignal: latest?.rawSignal ?? null,
    latestOutcome: latest?.outcome ?? null,
    latestReason: latest?.finalReason ?? null,
    liveTrading: false,
  };
}
