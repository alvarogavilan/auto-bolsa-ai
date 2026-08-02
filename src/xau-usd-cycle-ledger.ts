import type { XauPaperInstruction } from "./xau-usd-paper-runtime";

export interface XauPaperCycleRecord {
  schemaVersion: "xau-usd-paper-cycle-v1";
  cycleId: string;
  observedAt: number;
  instruction: XauPaperInstruction;
  outcome: "approved" | "blocked";
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
    metrics: { cycles: 0, approved: 0, blocked: 0, staleQuotes: 0, macroLockouts: 0, weakConsensus: 0, invalidQuotes: 0 },
    liveTrading: false,
  };
}

export function appendXauPaperCycle(
  ledger: XauPaperCycleLedger,
  instruction: XauPaperInstruction,
): XauPaperCycleLedger {
  const blockers = [...instruction.blockers];
  const record: XauPaperCycleRecord = {
    schemaVersion: "xau-usd-paper-cycle-v1",
    cycleId: `${instruction.createdAt}:${ledger.metrics.cycles + 1}`,
    observedAt: instruction.createdAt,
    instruction: structuredClone(instruction),
    outcome: instruction.allowed ? "approved" : "blocked",
    blockers,
    liveTrading: false,
    realOrderSubmission: false,
  };
  const text = blockers.join(" ").toLowerCase();
  return {
    ...ledger,
    cycles: [record, ...ledger.cycles].slice(0, 500),
    metrics: {
      cycles: ledger.metrics.cycles + 1,
      approved: ledger.metrics.approved + (instruction.allowed ? 1 : 0),
      blocked: ledger.metrics.blocked + (instruction.allowed ? 0 : 1),
      staleQuotes: ledger.metrics.staleQuotes + (text.includes("caducada") ? 1 : 0),
      macroLockouts: ledger.metrics.macroLockouts + (text.includes("evento macro") ? 1 : 0),
      weakConsensus: ledger.metrics.weakConsensus + (text.includes("consenso") ? 1 : 0),
      invalidQuotes: ledger.metrics.invalidQuotes + (text.includes("cotización") && text.includes("inválida") ? 1 : 0),
    },
    liveTrading: false,
  };
}
