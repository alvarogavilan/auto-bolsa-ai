import {
  MAX_SUBMISSION_ATTEMPTS,
  checkLiveGuardrails,
  submitOrder,
  type LiveExecutorSnapshot,
  type SubmitOrderResult,
} from "./live-executor";
import type { LiveGuardrailConfig } from "./live-guardrails";
import type { LivePreflightCertificate } from "./live-preflight-certificate";
import type { LiveOrderTransport } from "./live-transport";

export type AtomicCertificateConsumptionResult =
  | { ok: true; certificate: LivePreflightCertificate }
  | { ok: false; blockers: string[] };

/**
 * La implementación real debe hacer lectura, validación y escritura del
 * certificado dentro de una sección atómica local. La llamada de red al
 * exchange ocurre únicamente después de recibir `ok:true`.
 */
export interface AtomicLivePreflightCertificateStore {
  consumeForOrder(
    clOrdId: string,
    request: Readonly<LiveExecutorSnapshot["orders"][string]["request"]>,
    now: number,
  ): Promise<AtomicCertificateConsumptionResult>;
}

export type CertifiedSubmitOrderResult = SubmitOrderResult & {
  preflightCertificateConsumed: boolean;
  certificateId: string | null;
};

/**
 * Único camino permitido para un futuro envío LIVE certificado.
 *
 * Orden estricto:
 * 1. Revalidar kill switch, estado y guardrails sin tocar el certificado.
 * 2. Consumir y persistir atómicamente el certificado exacto.
 * 3. Solo entonces llamar a `submitOrder`, que puede contactar con Kraken.
 *
 * Si el transporte devuelve timeout o resultado ambiguo, el certificado ya
 * permanece consumido. Repetir esta función nunca puede reenviar la orden.
 */
export async function submitOrderWithAtomicPreflightCertificate(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  config: LiveGuardrailConfig,
  certificateStore: AtomicLivePreflightCertificateStore,
  clOrdId: string,
  now = Date.now(),
): Promise<CertifiedSubmitOrderResult> {
  const order = state.orders[clOrdId];
  if (!order) throw new Error(`Orden desconocida: ${clOrdId}`);

  // Estos caminos ya son fail-closed dentro de submitOrder y nunca contactan
  // con el transporte. No consumen un certificado que todavía podría usarse
  // tras corregir la configuración o reconciliar el estado.
  if (!config.liveTradingEnabled || order.status !== "prepared" || order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
    const result = await submitOrder(state, transport, config, clOrdId, now);
    return { ...result, preflightCertificateConsumed: false, certificateId: null };
  }

  const revalidation = checkLiveGuardrails(state, config, order.request, now, order.clOrdId);
  if (!revalidation.allowed) {
    const result = await submitOrder(state, transport, config, clOrdId, now);
    return { ...result, preflightCertificateConsumed: false, certificateId: null };
  }

  let authorization: AtomicCertificateConsumptionResult;
  try {
    authorization = await certificateStore.consumeForOrder(clOrdId, order.request, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo persistir el consumo del certificado";
    return {
      ok: false,
      state,
      order,
      blockers: [`Envío bloqueado antes del transporte: ${message}`],
      preflightCertificateConsumed: false,
      certificateId: null,
    };
  }

  if (!authorization.ok) {
    return {
      ok: false,
      state,
      order,
      blockers: authorization.blockers,
      preflightCertificateConsumed: false,
      certificateId: null,
    };
  }

  // Desde aquí el certificado ya está persistido como consumido. Cualquier
  // excepción, timeout o respuesta desconocida del transporte no permite
  // volver a utilizarlo.
  const result = await submitOrder(state, transport, config, clOrdId, now);
  return {
    ...result,
    preflightCertificateConsumed: true,
    certificateId: authorization.certificate.certificateId,
  };
}
