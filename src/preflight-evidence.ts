import type { AdminKrakenPreflightReport } from "./admin-kraken-preflight";

export const PREFLIGHT_EVIDENCE_SCHEMA = "kraken-preflight-evidence-v1" as const;
export const DEFAULT_REQUIRED_VALIDATIONS = 3;
export const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60_000;

export interface PreflightEvidenceEntry {
  schemaVersion: typeof PREFLIGHT_EVIDENCE_SCHEMA;
  sequence: number;
  recordedAt: number;
  checkedAt: number;
  pair: string;
  status: "validated" | "rejected" | "unknown";
  contactedKraken: boolean;
  validateFlagForced: true;
  matchingEngineSubmission: false | null;
  realOrderCreated: false | null;
  clOrdId: string | null;
  blockers: string[];
  anomaly: string | null;
  notionalEur: number;
  volumeBase: number;
  limitPrice: number;
  previousHash: string | null;
  hash: string;
}

export interface PreflightEvidenceLedger {
  schemaVersion: "kraken-preflight-ledger-v1";
  entries: PreflightEvidenceEntry[];
}

export interface PreflightEvidenceVerification {
  valid: boolean;
  checkedEntries: number;
  failureSequence: number | null;
  reason: string | null;
  latestHash: string | null;
}

export interface PreflightEvidenceReadiness {
  schemaVersion: "kraken-preflight-readiness-v1";
  chainValid: boolean;
  evidenceCount: number;
  consecutiveValidated: number;
  requiredConsecutiveValidated: number;
  latestCheckedAt: number | null;
  latestAgeMs: number | null;
  criticalAnomalyCount: number;
  blockers: string[];
  eligibleForManualPilotReview: boolean;
  liveTrading: false;
  message: string;
}

export interface AssessPreflightEvidenceOptions {
  now?: number;
  requiredConsecutiveValidated?: number;
  maxEvidenceAgeMs?: number;
}

function finiteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function entryPayload(entry: Omit<PreflightEvidenceEntry, "hash">): string {
  return JSON.stringify({
    schemaVersion: entry.schemaVersion,
    sequence: entry.sequence,
    recordedAt: entry.recordedAt,
    checkedAt: entry.checkedAt,
    pair: entry.pair,
    status: entry.status,
    contactedKraken: entry.contactedKraken,
    validateFlagForced: entry.validateFlagForced,
    matchingEngineSubmission: entry.matchingEngineSubmission,
    realOrderCreated: entry.realOrderCreated,
    clOrdId: entry.clOrdId,
    blockers: entry.blockers,
    anomaly: entry.anomaly,
    notionalEur: entry.notionalEur,
    volumeBase: entry.volumeBase,
    limitPrice: entry.limitPrice,
    previousHash: entry.previousHash,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyPreflightEvidenceLedger(): PreflightEvidenceLedger {
  return {
    schemaVersion: "kraken-preflight-ledger-v1",
    entries: [],
  };
}

export async function createPreflightEvidenceEntry(
  report: AdminKrakenPreflightReport,
  previous: PreflightEvidenceEntry | null,
  recordedAt = Date.now(),
): Promise<PreflightEvidenceEntry> {
  if (!finiteTimestamp(recordedAt)) throw new Error("recordedAt inválido para la evidencia de preflight");
  if (!finiteTimestamp(report.checkedAt)) throw new Error("checkedAt inválido para la evidencia de preflight");
  if (!report.pair.trim()) throw new Error("Par vacío en la evidencia de preflight");
  if (report.result.validateFlagForced !== true) throw new Error("El preflight no forzó validate=true");
  if (report.orderCreated !== false && report.orderCreated !== null) {
    throw new Error("La evidencia indica una posible orden real");
  }

  const withoutHash: Omit<PreflightEvidenceEntry, "hash"> = {
    schemaVersion: PREFLIGHT_EVIDENCE_SCHEMA,
    sequence: (previous?.sequence ?? 0) + 1,
    recordedAt,
    checkedAt: report.checkedAt,
    pair: report.pair,
    status: report.result.status,
    contactedKraken: report.result.contactedKraken,
    validateFlagForced: true,
    matchingEngineSubmission: report.result.matchingEngineSubmission,
    realOrderCreated: report.orderCreated,
    clOrdId: report.result.clOrdId,
    blockers: [...report.result.blockers],
    anomaly: report.result.anomaly,
    notionalEur: report.plan.intent.notionalEur,
    volumeBase: report.plan.intent.volumeBase,
    limitPrice: report.plan.intent.limitPrice,
    previousHash: previous?.hash ?? null,
  };

  return {
    ...withoutHash,
    hash: await sha256Hex(entryPayload(withoutHash)),
  };
}

export async function verifyPreflightEvidenceChain(
  entries: readonly PreflightEvidenceEntry[],
): Promise<PreflightEvidenceVerification> {
  let previousHash: string | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const expectedSequence = index + 1;
    if (entry.sequence !== expectedSequence) {
      return {
        valid: false,
        checkedEntries: index,
        failureSequence: entry.sequence,
        reason: `Secuencia no contigua: se esperaba ${expectedSequence}`,
        latestHash: previousHash,
      };
    }
    if (entry.previousHash !== previousHash) {
      return {
        valid: false,
        checkedEntries: index,
        failureSequence: entry.sequence,
        reason: "El enlace con la evidencia anterior no coincide",
        latestHash: previousHash,
      };
    }

    const { hash: _hash, ...withoutHash } = entry;
    const expectedHash = await sha256Hex(entryPayload(withoutHash));
    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        checkedEntries: index,
        failureSequence: entry.sequence,
        reason: "El hash de la evidencia no coincide con su contenido",
        latestHash: previousHash,
      };
    }
    previousHash = entry.hash;
  }

  return {
    valid: true,
    checkedEntries: entries.length,
    failureSequence: null,
    reason: null,
    latestHash: previousHash,
  };
}

export async function appendPreflightEvidence(
  ledger: PreflightEvidenceLedger,
  report: AdminKrakenPreflightReport,
  recordedAt = Date.now(),
): Promise<PreflightEvidenceLedger> {
  if (ledger.schemaVersion !== "kraken-preflight-ledger-v1") {
    throw new Error("Versión desconocida del registro de preflight");
  }
  const verification = await verifyPreflightEvidenceChain(ledger.entries);
  if (!verification.valid) {
    throw new Error(`Cadena de preflight inválida: ${verification.reason ?? "motivo desconocido"}`);
  }
  const previous = ledger.entries.at(-1) ?? null;
  const entry = await createPreflightEvidenceEntry(report, previous, recordedAt);
  return {
    ...ledger,
    entries: [...ledger.entries, entry],
  };
}

function isCriticalAnomaly(entry: PreflightEvidenceEntry): boolean {
  return entry.anomaly?.startsWith("unexpected_txid:") === true
    || entry.realOrderCreated !== false
    || entry.matchingEngineSubmission !== false && entry.status === "validated";
}

export async function assessPreflightEvidence(
  ledger: PreflightEvidenceLedger,
  options: AssessPreflightEvidenceOptions = {},
): Promise<PreflightEvidenceReadiness> {
  const now = options.now ?? Date.now();
  const required = options.requiredConsecutiveValidated ?? DEFAULT_REQUIRED_VALIDATIONS;
  const maxAgeMs = options.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
  if (!finiteTimestamp(now)) throw new Error("now inválido para evaluar el preflight");
  if (!Number.isInteger(required) || required < 1) throw new Error("requiredConsecutiveValidated debe ser un entero positivo");
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("maxEvidenceAgeMs debe ser positivo");

  const verification = await verifyPreflightEvidenceChain(ledger.entries);
  const blockers: string[] = [];
  if (!verification.valid) blockers.push(verification.reason ?? "La cadena de evidencias no es válida");

  const criticalAnomalyCount = ledger.entries.filter(isCriticalAnomaly).length;
  if (criticalAnomalyCount > 0) blockers.push("Existe una anomalía crítica o una posible creación de orden en el historial");

  const latest = ledger.entries.at(-1) ?? null;
  const latestAgeMs = latest ? Math.max(0, now - latest.checkedAt) : null;
  if (!latest) blockers.push("Todavía no existe ninguna validación de Kraken");
  if (latest && latest.checkedAt > now) blockers.push("La última evidencia tiene una fecha futura");
  if (latestAgeMs !== null && latestAgeMs > maxAgeMs) blockers.push("La última validación de Kraken está caducada");

  let consecutiveValidated = 0;
  const expectedPair = latest?.pair ?? null;
  for (let index = ledger.entries.length - 1; index >= 0; index -= 1) {
    const entry = ledger.entries[index];
    const safeValidation = entry.status === "validated"
      && entry.contactedKraken
      && entry.validateFlagForced
      && entry.matchingEngineSubmission === false
      && entry.realOrderCreated === false
      && entry.anomaly === null
      && entry.blockers.length === 0
      && entry.pair === expectedPair;
    if (!safeValidation) break;
    consecutiveValidated += 1;
  }
  if (consecutiveValidated < required) {
    blockers.push(`Se requieren ${required} validaciones consecutivas seguras del mismo par`);
  }

  const eligibleForManualPilotReview = blockers.length === 0;
  return {
    schemaVersion: "kraken-preflight-readiness-v1",
    chainValid: verification.valid,
    evidenceCount: ledger.entries.length,
    consecutiveValidated,
    requiredConsecutiveValidated: required,
    latestCheckedAt: latest?.checkedAt ?? null,
    latestAgeMs,
    criticalAnomalyCount,
    blockers,
    eligibleForManualPilotReview,
    liveTrading: false,
    message: eligibleForManualPilotReview
      ? "La evidencia técnica permite una revisión humana del piloto; no habilita trading real."
      : "El piloto continúa bloqueado hasta completar evidencias validate-only seguras.",
  };
}
