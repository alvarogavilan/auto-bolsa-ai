import type {
  AtomicCertificateConsumptionResult,
  AtomicLivePreflightCertificateStore,
} from "./live-certified-submission";
import {
  consumeLivePreflightCertificate,
  type LivePreflightCertificate,
} from "./live-preflight-certificate";
import type { LiveOrderRequest } from "./live-executor";

export const LIVE_PREFLIGHT_CERTIFICATE_KEY_PREFIX = "live-preflight-certificate-v1:";

export interface LivePreflightCertificatePersistence {
  get(key: string): Promise<LivePreflightCertificate | null>;
  put(key: string, certificate: LivePreflightCertificate): Promise<void>;
}

/**
 * Ejecuta una sección crítica local. En Durable Objects se implementará con
 * `ctx.blockConcurrencyWhile`, limitada exclusivamente a get/check/put local:
 * nunca debe incluir una llamada de red a Kraken.
 */
export interface LocalAtomicRunner {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function livePreflightCertificateStorageKey(clOrdId: string): string {
  if (!clOrdId.trim()) throw new Error("clOrdId vacío para almacenar el certificado");
  return `${LIVE_PREFLIGHT_CERTIFICATE_KEY_PREFIX}${clOrdId}`;
}

/**
 * Almacén de consumo de un solo uso. La validación criptográfica y la escritura
 * del `consumedAt` ocurren dentro de la misma sección crítica local.
 */
export class PersistedAtomicLivePreflightCertificateStore
implements AtomicLivePreflightCertificateStore {
  constructor(
    private readonly persistence: LivePreflightCertificatePersistence,
    private readonly atomicRunner: LocalAtomicRunner,
  ) {}

  async consumeForOrder(
    clOrdId: string,
    request: Readonly<LiveOrderRequest>,
    now: number,
  ): Promise<AtomicCertificateConsumptionResult> {
    return this.atomicRunner.run(async () => {
      const key = livePreflightCertificateStorageKey(clOrdId);
      const certificate = await this.persistence.get(key);
      if (!certificate) {
        return { ok: false as const, blockers: ["Falta certificado persistido de preflight"] };
      }

      try {
        const consumed = await consumeLivePreflightCertificate(certificate, clOrdId, request, now);
        // La autorización solo se devuelve después de que la persistencia del
        // consumo finalice correctamente. Un error de storage se propaga y el
        // llamador bloquea antes de contactar con el transporte.
        await this.persistence.put(key, consumed);
        return { ok: true as const, certificate: consumed };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Certificado de preflight inválido";
        return { ok: false as const, blockers: [message] };
      }
    });
  }
}
