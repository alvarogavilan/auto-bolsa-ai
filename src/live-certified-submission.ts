import {
  MAX_SUBMISSION_ATTEMPTS,
  checkLiveGuardrails,
  submitOrder,
  type LiveExecutorSnapshot,
  type SubmitOrderResult,
} from "./live-executor";
import type { LiveGuardrailConfig } from "./live-guardrails";
import type { LivePreflightCertificate } from "./live-preflight-certificate";
import type {
  PersistIntentResult,
  PersistedLiveSubmissionJournal,
} from "./live-submission-journal";
import type {
  LiveOrderTransport,
  LiveTransportAck,
  LiveTransportOrderRequest,
} from "./live-transport";

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

export type AtomicLiveSubmissionJournal = Pick<
  PersistedLiveSubmissionJournal,
  "persistIntent" | "recordTransportOutcome"
>;

export type CertifiedSubmitOrderResult = SubmitOrderResult & {
  preflightCertificateConsumed: boolean;
  certificateId: string | null;
  submissionIntentPersisted: boolean;
  journalId: string | null;
};

function blockedWithoutJournal(
  state: LiveExecutorSnapshot,
  clOrdId: string,
): CertifiedSubmitOrderResult {
  const order = state.orders[clOrdId];
  if (!order) throw new Error(`Orden desconocida: ${clOrdId}`);
  return {
    ok: false,
    state,
    order,
    blockers: ["Envío bloqueado: falta journal write-ahead persistente"],
    preflightCertificateConsumed: false,
    certificateId: null,
    submissionIntentPersisted: false,
    journalId: null,
  };
}

/** Envuelve únicamente `createOrder`; el resto de lecturas/cancelaciones se delega. */
function journaledTransport(
  transport: LiveOrderTransport,
  journal: AtomicLiveSubmissionJournal,
  clOrdId: string,
  now: number,
): LiveOrderTransport {
  return {
    createOrder: async (request: LiveTransportOrderRequest): Promise<LiveTransportAck> => {
      try {
        const ack = await transport.createOrder(request);
        try {
          await journal.recordTransportOutcome(clOrdId, ack, Date.now());
        } catch (error) {
          const message = error instanceof Error ? error.message : "No se pudo persistir el desenlace del transporte";
          throw new Error(`Desenlace no durable; reconciliación obligatoria: ${message}`);
        }
        return ack;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Fallo desconocido del transporte";
        try {
          await journal.recordTransportOutcome(
            clOrdId,
            { kind: "unknown", exchangeOrderId: null, raw: { message } },
            Date.now(),
          );
        } catch {
          // La intención ya está persistida. Aunque no pueda escribirse el
          // desenlace, la recuperación seguirá siendo reconciliation-only.
        }
        throw error;
      }
    },
    queryOrder: (exchangeOrderId) => transport.queryOrder(exchangeOrderId),
    findByClOrdId: (id) => transport.findByClOrdId(id),
    cancelOrder: (exchangeOrderId) => transport.cancelOrder(exchangeOrderId),
    listOpenOrders: () => transport.listOpenOrders(),
    listClosedOrders: () => transport.listClosedOrders(),
    fetchBalances: () => transport.fetchBalances(),
  };
}

/**
 * Único camino permitido para un futuro envío LIVE certificado.
 *
 * Orden estricto:
 * 1. Revalidar kill switch, estado y guardrails sin tocar certificado/journal.
 * 2. Consumir y persistir atómicamente el certificado exacto.
 * 3. Persistir la intención write-ahead exacta.
 * 4. Solo entonces llamar a `submitOrder`, con transporte instrumentado.
 *
 * Si el transporte devuelve timeout, el certificado queda consumido y el
 * journal queda pendiente. Repetir esta función nunca puede reenviar la orden.
 * `submissionJournal` es opcional solo para conservar compatibilidad de tipos:
 * su ausencia bloquea siempre antes de consumir el certificado.
 */
export async function submitOrderWithAtomicPreflightCertificate(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  config: LiveGuardrailConfig,
  certificateStore: AtomicLivePreflightCertificateStore,
  clOrdId: string,
  now = Date.now(),
  submissionJournal?: AtomicLiveSubmissionJournal,
): Promise<CertifiedSubmitOrderResult> {
  const order = state.orders[clOrdId];
  if (!order) throw new Error(`Orden desconocida: ${clOrdId}`);

  if (!submissionJournal) return blockedWithoutJournal(state, clOrdId);

  // Estos caminos ya son fail-closed dentro de submitOrder y nunca contactan
  // con el transporte. No consumen un certificado que todavía podría usarse
  // tras corregir la configuración o reconciliar el estado.
  if (!config.liveTradingEnabled || order.status !== "prepared" || order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
    const result = await submitOrder(state, transport, config, clOrdId, now);
    return {
      ...result,
      preflightCertificateConsumed: false,
      certificateId: null,
      submissionIntentPersisted: false,
      journalId: null,
    };
  }

  const revalidation = checkLiveGuardrails(state, config, order.request, now, order.clOrdId);
  if (!revalidation.allowed) {
    const result = await submitOrder(state, transport, config, clOrdId, now);
    return {
      ...result,
      preflightCertificateConsumed: false,
      certificateId: null,
      submissionIntentPersisted: false,
      journalId: null,
    };
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
      submissionIntentPersisted: false,
      journalId: null,
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
      submissionIntentPersisted: false,
      journalId: null,
    };
  }

  const transportRequest: LiveTransportOrderRequest = {
    clOrdId: order.clOrdId,
    pair: order.request.pair,
    side: order.request.side,
    volumeBase: String(order.request.volumeBase),
    limitPrice: String(order.request.limitPrice),
  };

  let journalResult: PersistIntentResult;
  try {
    journalResult = await submissionJournal.persistIntent(
      clOrdId,
      authorization.certificate.certificateId,
      transportRequest,
      order.request,
      now,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo persistir el journal";
    return {
      ok: false,
      state,
      order,
      blockers: [`Certificado consumido, pero envío bloqueado antes del transporte: ${message}`],
      preflightCertificateConsumed: true,
      certificateId: authorization.certificate.certificateId,
      submissionIntentPersisted: false,
      journalId: null,
    };
  }

  if (!journalResult.ok || !journalResult.entry) {
    return {
      ok: false,
      state,
      order,
      blockers: journalResult.blockers,
      preflightCertificateConsumed: true,
      certificateId: authorization.certificate.certificateId,
      submissionIntentPersisted: false,
      journalId: journalResult.entry?.journalId ?? null,
    };
  }

  const result = await submitOrder(
    state,
    journaledTransport(transport, submissionJournal, clOrdId, now),
    config,
    clOrdId,
    now,
  );
  return {
    ...result,
    preflightCertificateConsumed: true,
    certificateId: authorization.certificate.certificateId,
    submissionIntentPersisted: true,
    journalId: journalResult.entry.journalId,
  };
}
