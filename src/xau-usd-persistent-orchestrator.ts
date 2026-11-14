import { appendXauPaperCycle, createXauPaperCycleLedger, type XauPaperCycleLedger } from "./xau-usd-cycle-ledger";
import {
  applyXauPaperPositionCycle,
  parseXauPaperPositionBook,
  XAU_PAPER_POSITION_KEY,
  type XauPaperPositionBook,
} from "./xau-usd-paper-position";
import { buildXauUsdPaperInstruction, type XauPaperRuntimeInput, type XauPaperInstruction } from "./xau-usd-paper-runtime";

export const XAU_PAPER_LEDGER_KEY = "xau-usd:paper-cycle-ledger:v1";

export interface XauPaperStateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface XauPersistentCycleResult {
  schemaVersion: "xau-usd-persistent-cycle-v2";
  instruction: XauPaperInstruction;
  ledger: XauPaperCycleLedger;
  positionBook: XauPaperPositionBook;
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

/**
 * Decide qué se escribe en disco en cada ciclo.
 *
 * El plan gratuito de Durable Objects admite 100.000 filas escritas al día.
 * Escribir ledger y libro en cada muestra rápida (cada 3 s) agotaba el cupo
 * antes del mediodía y dejaba TODO el estado inaccesible hasta medianoche UTC.
 *
 * - Ledger: solo ciclos de decisión (las muestras rápidas no aportan decisión).
 * - Libro: siempre que se abra o cierre una posición; con posición abierta, en
 *   cada decisión y, en muestras rápidas, solo si cambia la protección (stop,
 *   objetivo o trailing). Sin posición y sin evento no hay nada que guardar.
 */
export function planXauPersistence(
  monitoring: boolean,
  before: XauPaperPositionBook,
  after: XauPaperPositionBook,
): { ledger: boolean; positionBook: boolean } {
  const lifecycleEvent = (before.open?.id ?? null) !== (after.open?.id ?? null)
    || before.metrics.closed !== after.metrics.closed
    || before.metrics.opened !== after.metrics.opened;
  const protectionChanged = Boolean(before.open && after.open) && (
    before.open?.stopPrice !== after.open?.stopPrice
    || before.open?.targetPrice !== after.open?.targetPrice
    || before.open?.trailingActive !== after.open?.trailingActive
  );
  return {
    ledger: !monitoring,
    positionBook: lifecycleEvent || protectionChanged || (!monitoring && after.open !== null),
  };
}

export async function runPersistentXauPaperCycle(
  store: XauPaperStateStore,
  input: XauPaperRuntimeInput,
): Promise<XauPersistentCycleResult> {
  const instruction = buildXauUsdPaperInstruction(input);
  const current = parseLedger(await store.get(XAU_PAPER_LEDGER_KEY));
  const currentPositionBook = parseXauPaperPositionBook(await store.get(XAU_PAPER_POSITION_KEY));
  const duplicate = current.cycles.some((cycle) =>
    cycle.observedAt === instruction.createdAt
    && cycle.instruction.quoteSource === instruction.quoteSource
    && cycle.instruction.referencePrice === instruction.referencePrice,
  );

  if (duplicate) {
    return {
      schemaVersion: "xau-usd-persistent-cycle-v2",
      instruction,
      ledger: current,
      positionBook: currentPositionBook,
      persisted: false,
      duplicate: true,
      liveTrading: false,
      realOrderSubmission: false,
    };
  }

  const ledger = appendXauPaperCycle(current, instruction);
  const positionBook = applyXauPaperPositionCycle(currentPositionBook, instruction, input);
  const plan = planXauPersistence(instruction.cycleKind === "monitoring", currentPositionBook, positionBook);
  if (plan.ledger) await store.put(XAU_PAPER_LEDGER_KEY, JSON.stringify(ledger));
  if (plan.positionBook) await store.put(XAU_PAPER_POSITION_KEY, JSON.stringify(positionBook));
  return {
    schemaVersion: "xau-usd-persistent-cycle-v2",
    instruction,
    ledger: plan.ledger ? ledger : current,
    positionBook: plan.positionBook ? positionBook : currentPositionBook,
    persisted: plan.ledger || plan.positionBook,
    duplicate: false,
    liveTrading: false,
    realOrderSubmission: false,
  };
}
