import { appendXauPaperCycle, createXauPaperCycleLedger, type XauPaperCycleLedger } from "./xau-usd-cycle-ledger";
import { buildXauUsdPaperInstruction, type XauPaperRuntimeInput, type XauPaperInstruction } from "./xau-usd-paper-runtime";

export const XAU_PAPER_LEDGER_KEY = "xau-usd:paper-cycle-ledger:v1";

export interface XauPaperStateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface XauPersistentCycleResult {
  schemaVersion: "xau-usd-persistent-cycle-v1";
  instruction: XauPaperInstruction;
  ledger: XauPaperCycleLedger;
  persisted: boolean;
  duplicate: boolean;
  liveTrading: false;
  realOrderSubmission: false;
}

function parseLedger(raw: string | null): XauPaperCycleLedger {
  if (!raw) return createXauPaperCycleLedger();
  try {
    const value = JSON.parse(raw) as Partial<XauPaperCycleLedger>;
    if (value.schemaVersion !== "xau-usd-paper-cycle-ledger-v1" || value.market !== "XAU/USD") {
      return createXauPaperCycleLedger();
    }
    return value as XauPaperCycleLedger;
  } catch {
    return createXauPaperCycleLedger();
  }
}

export async function runPersistentXauPaperCycle(
  store: XauPaperStateStore,
  input: XauPaperRuntimeInput,
): Promise<XauPersistentCycleResult> {
  const instruction = buildXauUsdPaperInstruction(input);
  const current = parseLedger(await store.get(XAU_PAPER_LEDGER_KEY));
  const duplicate = current.cycles.some((cycle) =>
    cycle.observedAt === instruction.createdAt
    && cycle.instruction.quoteSource === instruction.quoteSource
    && cycle.instruction.referencePrice === instruction.referencePrice,
  );

  if (duplicate) {
    return {
      schemaVersion: "xau-usd-persistent-cycle-v1",
      instruction,
      ledger: current,
      persisted: false,
      duplicate: true,
      liveTrading: false,
      realOrderSubmission: false,
    };
  }

  const ledger = appendXauPaperCycle(current, instruction);
  await store.put(XAU_PAPER_LEDGER_KEY, JSON.stringify(ledger));
  return {
    schemaVersion: "xau-usd-persistent-cycle-v1",
    instruction,
    ledger,
    persisted: true,
    duplicate: false,
    liveTrading: false,
    realOrderSubmission: false,
  };
}
