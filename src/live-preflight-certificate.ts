import type { LiveOrderRequest } from "./live-executor";
import type {
  LiveOrderPreflightIntent,
  LiveOrderPreflightResult,
} from "./live-order-preflight";

export const DEFAULT_PREFLIGHT_CERTIFICATE_TTL_MS = 2 * 60_000;
export const MAX_PREFLIGHT_CERTIFICATE_TTL_MS = 5 * 60_000;

interface CertifiedIntent {
  pair: string;
  side: "buy" | "sell";
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
}

export interface LivePreflightCertificate {
  schemaVersion: "live-preflight-certificate-v1";
  certificateId: string;
  clOrdId: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  intent: CertifiedIntent;
  intentFingerprintSha256: string;
  proof: {
    contactedKraken: true;
    validateFlagForced: true;
    matchingEngineSubmission: false;
    realOrderCreated: false;
    anomaly: null;
  };
}

export interface CreateLivePreflightCertificateOptions {
  ttlMs?: number;
  certificateIdFactory?: () => string;
}

export interface LivePreflightCertificateCheck {
  allowed: boolean;
  blockers: string[];
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function canonicalNumber(value: number): string {
  if (!finitePositive(value)) throw new Error("El certificado contiene un número no positivo o no finito");
  return Number(value.toPrecision(15)).toString();
}

function canonicalIntent(intent: CertifiedIntent, clOrdId: string): string {
  if (!clOrdId.trim()) throw new Error("El certificado requiere clOrdId");
  if (!intent.pair.trim()) throw new Error("El certificado requiere un par");
  if (intent.side !== "buy" && intent.side !== "sell") throw new Error("Lado inválido en el certificado");

  return JSON.stringify([
    "live-preflight-certificate-v1",
    clOrdId,
    intent.pair,
    intent.side,
    canonicalNumber(intent.volumeBase),
    canonicalNumber(intent.limitPrice),
    canonicalNumber(intent.notionalEur),
  ]);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactIntentFromOrder(request: LiveOrderRequest): CertifiedIntent {
  return {
    pair: request.pair,
    side: request.side,
    volumeBase: request.volumeBase,
    limitPrice: request.limitPrice,
    notionalEur: request.notionalEur,
  };
}

function validatedResultBlockers(result: LiveOrderPreflightResult): string[] {
  const blockers: string[] = [];
  if (result.status !== "validated") blockers.push("El preflight no terminó en estado validated");
  if (!result.contactedKraken) blockers.push("El preflight no contactó con Kraken");
  if (result.validateFlagForced !== true) blockers.push("El preflight no certifica validate=true");
  if (result.matchingEngineSubmission !== false) blockers.push("No se puede demostrar que la orden no llegó al motor de casación");
  if (result.realOrderCreated !== false) blockers.push("No se puede demostrar que no se creó una orden real");
  if (!result.clOrdId?.trim()) blockers.push("El preflight no devolvió clOrdId");
  if (result.blockers.length > 0) blockers.push(...result.blockers);
  if (result.anomaly !== null) blockers.push(`El preflight contiene una anomalía: ${result.anomaly}`);
  if (!Number.isFinite(result.checkedAt) || result.checkedAt <= 0) blockers.push("checkedAt inválido");
  return blockers;
}

/**
 * Emite un certificado de un solo uso únicamente después de una respuesta
 * validate-only plenamente verificable. No activa LIVE ni crea órdenes.
 */
export async function createLivePreflightCertificate(
  intent: LiveOrderPreflightIntent,
  result: LiveOrderPreflightResult,
  options: CreateLivePreflightCertificateOptions = {},
): Promise<LivePreflightCertificate> {
  const blockers = validatedResultBlockers(result);
  if (blockers.length > 0) throw new Error(`No se puede emitir el certificado: ${blockers.join("; ")}`);

  const ttlMs = options.ttlMs ?? DEFAULT_PREFLIGHT_CERTIFICATE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PREFLIGHT_CERTIFICATE_TTL_MS) {
    throw new Error(`TTL inválido: debe estar entre 1 y ${MAX_PREFLIGHT_CERTIFICATE_TTL_MS} ms`);
  }

  const clOrdId = result.clOrdId as string;
  const certifiedIntent: CertifiedIntent = {
    pair: intent.pair,
    side: intent.side,
    volumeBase: intent.volumeBase,
    limitPrice: intent.limitPrice,
    notionalEur: intent.notionalEur,
  };
  const fingerprint = await sha256Hex(canonicalIntent(certifiedIntent, clOrdId));

  return {
    schemaVersion: "live-preflight-certificate-v1",
    certificateId: options.certificateIdFactory?.() ?? crypto.randomUUID(),
    clOrdId,
    issuedAt: result.checkedAt,
    expiresAt: result.checkedAt + ttlMs,
    consumedAt: null,
    intent: certifiedIntent,
    intentFingerprintSha256: fingerprint,
    proof: {
      contactedKraken: true,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      anomaly: null,
    },
  };
}

/**
 * Verifica caducidad, uso único, integridad y coincidencia exacta con la orden
 * futura. No admite tolerancias: un cambio de precio o volumen exige repetir
 * el preflight con datos públicos actuales.
 */
export async function checkLivePreflightCertificate(
  certificate: LivePreflightCertificate,
  clOrdId: string,
  request: LiveOrderRequest,
  now = Date.now(),
): Promise<LivePreflightCertificateCheck> {
  const blockers: string[] = [];

  if (certificate.schemaVersion !== "live-preflight-certificate-v1") blockers.push("Versión de certificado desconocida");
  if (certificate.consumedAt !== null) blockers.push("El certificado ya fue consumido");
  if (!Number.isFinite(now) || now <= 0) blockers.push("Reloj inválido para verificar el certificado");
  if (now < certificate.issuedAt) blockers.push("El reloj está situado antes de la emisión del certificado");
  if (now >= certificate.expiresAt) blockers.push("El certificado ha caducado");
  if (certificate.expiresAt - certificate.issuedAt > MAX_PREFLIGHT_CERTIFICATE_TTL_MS) {
    blockers.push("El certificado supera la caducidad máxima permitida");
  }
  if (certificate.clOrdId !== clOrdId) blockers.push("clOrdId distinto del validado por Kraken");
  if (certificate.proof.contactedKraken !== true) blockers.push("Falta prueba de contacto con Kraken");
  if (certificate.proof.validateFlagForced !== true) blockers.push("Falta prueba de validate=true");
  if (certificate.proof.matchingEngineSubmission !== false) blockers.push("No se descarta envío al motor de casación");
  if (certificate.proof.realOrderCreated !== false) blockers.push("No se descarta creación de orden real");
  if (certificate.proof.anomaly !== null) blockers.push("El certificado contiene una anomalía");

  let expectedFingerprint: string | null = null;
  let orderFingerprint: string | null = null;
  try {
    expectedFingerprint = await sha256Hex(canonicalIntent(certificate.intent, certificate.clOrdId));
    orderFingerprint = await sha256Hex(canonicalIntent(exactIntentFromOrder(request), clOrdId));
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "No se pudo calcular la huella del certificado");
  }

  if (expectedFingerprint !== null && expectedFingerprint !== certificate.intentFingerprintSha256) {
    blockers.push("La huella almacenada no coincide con el contenido del certificado");
  }
  if (expectedFingerprint !== null && orderFingerprint !== null && expectedFingerprint !== orderFingerprint) {
    blockers.push("La orden no coincide exactamente con la intención validada");
  }

  return { allowed: blockers.length === 0, blockers };
}

/** Marca el certificado como usado tras superar la comprobación exacta. */
export async function consumeLivePreflightCertificate(
  certificate: LivePreflightCertificate,
  clOrdId: string,
  request: LiveOrderRequest,
  now = Date.now(),
): Promise<LivePreflightCertificate> {
  const check = await checkLivePreflightCertificate(certificate, clOrdId, request, now);
  if (!check.allowed) throw new Error(`Certificado bloqueado: ${check.blockers.join("; ")}`);
  return { ...certificate, consumedAt: now };
}
