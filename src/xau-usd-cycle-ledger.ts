import type { XauPaperInstruction } from "./xau-usd-paper-runtime";

// Cada escritura del ledger consume cuota diaria de Durable Objects en
// proporción a su tamaño: 30 ciclos (una hora de decisiones) bastan para el
// diagnóstico y dejan el registro en torno a 100 KB.
const MAX_RETAINED_CYCLES = 30;
const MAX_LEDGER_RECORD_BYTES = 120_000;

export interface XauPaperCycleRecord {
  schemaVersion: "xau-usd-paper-cycle-v1";
  cycleId: string;
  observedAt: number;
  instruction: XauPaperInstruction;
  outcome: "approved" | "blocked" | "observed";
  blockers: string[];
  liveTrading: false;
  realOrderSubmission: false;
}

export interface XauPaperCycleLedger {
  schemaVersion: "xau-usd-paper-cycle-ledger-v1";
  market: "XAU/USD";
  cycles: XauPaperCycleRecord[];
  metrics: {
    cycles: number;
    decisionCycles: number;
    monitoringSamples: number;
    approved: number;
    blocked: number;
    staleQuotes: number;
    macroLockouts: number;
    weakConsensus: number;
    invalidQuotes: number;
  };
  liveTrading: false;
}

export function createXauPaperCycleLedger(): XauPaperCycleLedger {
  return {
    schemaVersion: "xau-usd-paper-cycle-ledger-v1",
    market: "XAU/USD",
    cycles: [],
    metrics: {
      cycles: 0,
      decisionCycles: 0,
      monitoringSamples: 0,
      approved: 0,
      blocked: 0,
      staleQuotes: 0,
      macroLockouts: 0,
      weakConsensus: 0,
      invalidQuotes: 0,
    },
    liveTrading: false,
  };
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function compactCycles(records: XauPaperCycleRecord[]): XauPaperCycleRecord[] {
  const retained: XauPaperCycleRecord[] = [];
  let bytes = 0;
  for (const record of records.slice(0, MAX_RETAINED_CYCLES)) {
    const recordBytes = encodedBytes(record);
    if (retained.length > 0 && bytes + recordBytes > MAX_LEDGER_RECORD_BYTES) break;
    retained.push(record);
    bytes += recordBytes;
    if (bytes >= MAX_LEDGER_RECORD_BYTES) break;
  }
  return retained;
}

export function appendXauPaperCycle(
  ledger: XauPaperCycleLedger,
  instruction: XauPaperInstruction,
): XauPaperCycleLedger {
  const monitoring = instruction.cycleKind === "monitoring";
  const blockers = monitoring ? [] : [...instruction.blockers];
  const current = ledger.metrics;
  const record: XauPaperCycleRecord = {
    schemaVersion: "xau-usd-paper-cycle-v1",
    cycleId: `${instruction.createdAt}:${(current.cycles ?? 0) + 1}`,
    observedAt: instruction.createdAt,
    instruction: structuredClone(instruction),
    outcome: monitoring ? "observed" : instruction.allowed ? "approved" : "blocked",
    blockers,
    liveTrading: false,
    realOrderSubmission: false,
  };
  const text = blockers.join(" ").toLowerCase();
  return {
    ...ledger,
    cycles: compactCycles([record, ...ledger.cycles]),
    metrics: {
      cycles: (current.cycles ?? 0) + 1,
      decisionCycles: (current.decisionCycles ?? ((current.approved ?? 0) + (current.blocked ?? 0))) + (monitoring ? 0 : 1),
      monitoringSamples: (current.monitoringSamples ?? 0) + (monitoring ? 1 : 0),
      approved: (current.approved ?? 0) + (!monitoring && instruction.allowed ? 1 : 0),
      blocked: (current.blocked ?? 0) + (!monitoring && !instruction.allowed ? 1 : 0),
      staleQuotes: (current.staleQuotes ?? 0) + (!monitoring && text.includes("caducada") ? 1 : 0),
      macroLockouts: (current.macroLockouts ?? 0) + (!monitoring && text.includes("evento macro") ? 1 : 0),
      weakConsensus: (current.weakConsensus ?? 0) + (!monitoring && text.includes("consenso") ? 1 : 0),
      invalidQuotes: (current.invalidQuotes ?? 0) + (!monitoring && text.includes("cotización") && text.includes("inválida") ? 1 : 0),
    },
    liveTrading: false,
  };
}
