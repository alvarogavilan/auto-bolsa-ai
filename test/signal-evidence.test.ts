import { describe, expect, it } from "vitest";
import {
  appendSignalEvidence,
  emptySignalEvidenceLedger,
  SIGNAL_EVIDENCE_RETENTION,
  type SignalEvidenceEntry,
} from "../src/signal-evidence";

function entry(
  candleTime: number,
  rawSignal: SignalEvidenceEntry["rawSignal"],
  outcome: SignalEvidenceEntry["outcome"],
): SignalEvidenceEntry {
  return {
    schemaVersion: "paper-signal-evidence-v1",
    candleTime,
    recordedAt: candleTime * 1000,
    price: 50_000,
    fastEma: 50_100,
    slowEma: 50_000,
    previousFastEma: 49_900,
    previousSlowEma: 50_000,
    rsi: 55,
    rawSignal,
    rawReason: "test raw",
    outcome,
    finalReason: "test final",
    hadPositionBefore: false,
    hasPositionAfter: outcome === "buy-executed",
    equityEur: 50,
    cashEur: 50,
  };
}

describe("signal evidence ledger", () => {
  it("separates raw signals from final execution outcomes", () => {
    let ledger = emptySignalEvidenceLedger();
    ledger = appendSignalEvidence(ledger, entry(1, "buy", "cooldown-blocked"));
    ledger = appendSignalEvidence(ledger, entry(2, "buy", "buy-executed"));
    ledger = appendSignalEvidence(ledger, entry(3, "hold", "hold"));
    ledger = appendSignalEvidence(ledger, entry(4, "sell", "stop-loss-executed"));
    ledger = appendSignalEvidence(ledger, entry(5, "buy", "execution-blocked"));

    expect(ledger.stats.uniqueCandlesRecorded).toBe(5);
    expect(ledger.stats.rawBuySignals).toBe(3);
    expect(ledger.stats.rawSellSignals).toBe(1);
    expect(ledger.stats.rawHoldSignals).toBe(1);
    expect(ledger.stats.buysExecuted).toBe(1);
    expect(ledger.stats.sellsExecuted).toBe(1);
    expect(ledger.stats.stopLossesExecuted).toBe(1);
    expect(ledger.stats.cooldownBlocks).toBe(1);
    expect(ledger.stats.executionBlocks).toBe(1);
    expect(ledger.stats.holds).toBe(1);
  });

  it("retains recent entries while preserving cumulative totals", () => {
    let ledger = emptySignalEvidenceLedger();
    for (let index = 0; index < SIGNAL_EVIDENCE_RETENTION + 25; index += 1) {
      ledger = appendSignalEvidence(ledger, entry(index, "hold", "hold"));
    }

    expect(ledger.entries).toHaveLength(SIGNAL_EVIDENCE_RETENTION);
    expect(ledger.stats.uniqueCandlesRecorded).toBe(SIGNAL_EVIDENCE_RETENTION + 25);
    expect(ledger.entries[0]?.candleTime).toBe(SIGNAL_EVIDENCE_RETENTION + 24);
    expect(ledger.entries.at(-1)?.candleTime).toBe(25);
  });
});
