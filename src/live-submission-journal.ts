import type { LiveOrderRequest } from "./live-executor";
import type { LiveTransportAck, LiveTransportOrderRequest } from "./live-transport";

export type LiveSubmissionJournalPhase =
  | "intent_persisted"
  | "transport_outcome_recorded"
  | "reconciled";

export interface LiveSubmissionJournalEntry {
  schemaVersion: "live-submission-journal-v1";
  journalId: string;
  clOrdId: string;
  certificateId: string;
  createdAt: number;
  updatedAt: number;
  phase: LiveSubmissionJournalPhase;
  order: {
    pair: string;
    side: "buy" | "sell";
    volumeBase: string;
    limitPrice: string;
    notionalEur: number;
  };
  orderFingerprintSha256: string;
  transportOutcome: {
    kind: LiveTransportAck["kind"];
    exchangeOrderId: string | null;
    recordedAt: number;
  } | null;
  reconciledAt: number | null;
}

export interface LiveSubmissionJournalPersistence {
  get(key: string): Promise<LiveSubmissionJournalEntry | null>;
  put(key: string, value: LiveSubmissionJournalEntry): Promise<void>;
}

export interface LiveSubmissionJournalCriticalSection {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface PersistIntentResult {
  ok: boolean;
  entry: LiveSubmissionJournalEntry | null;
  created: boolean;
  blockers: string[];
}

export interface JournalRecoveryDecision {
  action: "none" | "reconcile_only";
  blockers: string[];
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function canonicalNumber(value: number): string {
  if (!finitePositive(value)) throw new Error("Número económico no positivo o no finito");
  return Number(value.toPrecision(15)).toString();
}

function canonicalOrder(
  clOrdId: string,
  certificateId: string,
  order: LiveTransportOrderRequest,
  notionalEur: number,
): string {
  if (!clOrdId.trim()) throw new Error("Falta clOrdId para el journal");
  if (!certificateId.trim()) throw new Error("Falta certificateId para el journal");
  if (!order.pair.trim()) throw new Error("Falta par para el journal");
  if (order.side !== "buy" && order.side !== "sell") throw new Error("Lado inválido para el journal");

  const volume = Number(order.volumeBase);
  const price = Number(order.limitPrice);
  return JSON.stringify([
    "live-submission-journal-v1",
    clOrdId,
    certificateId,
    order.pair,
    order.side,
    canonicalNumber(volume),
    canonicalNumber(price),
    canonicalNumber(notionalEur),
  ]);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function liveSubmissionJournalStorageKey(clOrdId: string): string {
  if (!clOrdId.trim()) throw new Error("Falta clOrdId para la clave del journal");
  return `live-submission-journal-v1:${clOrdId}`;
}

function requestsMatch(entry: LiveSubmissionJournalEntry, fingerprint: string): boolean {
  return entry.orderFingerprintSha256 === fingerprint;
}

/**
 * Diario write-ahead: la intención se persiste antes de cualquier llamada de
 * red. Una entrada existente nunca autoriza un nuevo envío; como máximo
 * demuestra que la orden debe localizarse y reconciliarse.
 */
export class PersistedLiveSubmissionJournal {
  constructor(
    private readonly persistence: LiveSubmissionJournalPersistence,
    private readonly criticalSection: LiveSubmissionJournalCriticalSection,
  ) {}

  async persistIntent(
    clOrdId: string,
    certificateId: string,
    order: LiveTransportOrderRequest,
    sourceRequest: LiveOrderRequest,
    now = Date.now(),
  ): Promise<PersistIntentResult> {
    return this.criticalSection.run(async () => {
      let canonical: string;
      let fingerprint: string;
      try {
        canonical = canonicalOrder(clOrdId, certificateId, order, sourceRequest.notionalEur);
        fingerprint = await sha256Hex(canonical);
      } catch (error) {
        return {
          ok: false,
          entry: null,
          created: false,
          blockers: [error instanceof Error ? error.message : "No se pudo construir la intención de envío"],
        };
      }

      const key = liveSubmissionJournalStorageKey(clOrdId);
      const existing = await this.persistence.get(key);
      if (existing) {
        const blockers = requestsMatch(existing, fingerprint)
          ? ["Ya existe una intención persistida; cualquier recuperación debe reconciliar, nunca reenviar"]
          : ["Existe un journal para el mismo clOrdId con un payload diferente"];
        return { ok: false, entry: existing, created: false, blockers };
      }

      const entry: LiveSubmissionJournalEntry = {
        schemaVersion: "live-submission-journal-v1",
        journalId: crypto.randomUUID(),
        clOrdId,
        certificateId,
        createdAt: now,
        updatedAt: now,
        phase: "intent_persisted",
        order: {
          pair: order.pair,
          side: order.side,
          volumeBase: order.volumeBase,
          limitPrice: order.limitPrice,
          notionalEur: sourceRequest.notionalEur,
        },
        orderFingerprintSha256: fingerprint,
        transportOutcome: null,
        reconciledAt: null,
      };

      await this.persistence.put(key, entry);
      return { ok: true, entry, created: true, blockers: [] };
    });
  }

  async recordTransportOutcome(
    clOrdId: string,
    ack: LiveTransportAck,
    now = Date.now(),
  ): Promise<LiveSubmissionJournalEntry> {
    return this.criticalSection.run(async () => {
      const key = liveSubmissionJournalStorageKey(clOrdId);
      const existing = await this.persistence.get(key);
      if (!existing) throw new Error("No existe intención persistida para registrar el desenlace del transporte");
      if (existing.phase === "reconciled") return existing;

      const updated: LiveSubmissionJournalEntry = {
        ...existing,
        updatedAt: now,
        phase: "transport_outcome_recorded",
        transportOutcome: {
          kind: ack.kind,
          exchangeOrderId: ack.exchangeOrderId,
          recordedAt: now,
        },
      };
      await this.persistence.put(key, updated);
      return updated;
    });
  }

  async markReconciled(clOrdId: string, now = Date.now()): Promise<LiveSubmissionJournalEntry> {
    return this.criticalSection.run(async () => {
      const key = liveSubmissionJournalStorageKey(clOrdId);
      const existing = await this.persistence.get(key);
      if (!existing) throw new Error("No existe journal para marcar como reconciliado");
      if (existing.phase === "reconciled") return existing;

      const updated: LiveSubmissionJournalEntry = {
        ...existing,
        updatedAt: now,
        phase: "reconciled",
        reconciledAt: now,
      };
      await this.persistence.put(key, updated);
      return updated;
    });
  }

  async recoveryDecision(clOrdId: string): Promise<JournalRecoveryDecision> {
    const entry = await this.persistence.get(liveSubmissionJournalStorageKey(clOrdId));
    if (!entry || entry.phase === "reconciled") return { action: "none", blockers: [] };

    return {
      action: "reconcile_only",
      blockers: [
        entry.phase === "intent_persisted"
          ? "La intención fue persistida pero no existe un desenlace durable; el envío es ambiguo"
          : "Existe un desenlace de transporte pendiente de reconciliación con orden, fills y balances",
      ],
    };
  }
}
