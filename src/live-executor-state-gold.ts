import { CoordinatedLiveExecutorState } from "./live-executor-state-coordinated";
import type { LiveExecutorSnapshot, LiveOrderRequest } from "./live-executor";
import { livePreflightCertificateStorageKey } from "./live-preflight-certificate-store";
import type { Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const JOURNAL_STORAGE_PREFIX = "live-submission-journal-v1:";

interface PrepareValidationBody {
  eurBalance: number;
  request: LiveOrderRequest;
}

function isSafeStalePreparedOrder(state: LiveExecutorSnapshot, configuredPair: string): boolean {
  if (!state.activeClOrdId) return false;
  const order = state.orders[state.activeClOrdId];
  if (!order || order.request.pair === configuredPair) return false;
  return order.status === "prepared"
    && order.exchangeOrderId === null
    && order.attempts === 0
    && order.filledVolumeBase === 0
    && state.inventory.quantityBase === 0
    && state.inventory.reservedQuantityBase === 0;
}

/**
 * El cambio de XBTEUR a PAXGEUR puede dejar una propuesta validate-only antigua
 * en Durable Object. Solo se elimina automáticamente cuando existe evidencia
 * local de que nunca fue enviada, ejecutada ni conciliada. Cualquier rastro de
 * journal o inventario mantiene el estado bloqueado y exige revisión.
 */
export class GoldLiveExecutorState extends CoordinatedLiveExecutorState {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/prepare-validation") {
      return super.fetch(request);
    }

    let body: PrepareValidationBody;
    try {
      body = await request.clone().json<PrepareValidationBody>();
    } catch {
      return super.fetch(request);
    }

    const configuredPair = this.env.PAIR || "PAXGEUR";
    if (body.request?.pair !== configuredPair) return super.fetch(request);

    await this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get<LiveExecutorSnapshot>(STORAGE_KEY);
      if (!state || !isSafeStalePreparedOrder(state, configuredPair) || !state.activeClOrdId) return;

      const staleClOrdId = state.activeClOrdId;
      const pendingJournal = await this.ctx.storage.get(`${JOURNAL_STORAGE_PREFIX}${staleClOrdId}`);
      if (pendingJournal) return;

      const staleOrder = state.orders[staleClOrdId];
      delete state.orders[staleClOrdId];
      if (staleOrder) delete state.idempotencyIndex[staleOrder.idempotencyKey];
      state.activeClOrdId = null;
      state.updatedAt = Date.now();
      await this.ctx.storage.delete(livePreflightCertificateStorageKey(staleClOrdId));
      await this.ctx.storage.put(STORAGE_KEY, state);
    });

    return super.fetch(request);
  }
}
