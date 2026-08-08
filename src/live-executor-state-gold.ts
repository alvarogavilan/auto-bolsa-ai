import { CoordinatedLiveExecutorState } from "./live-executor-state-coordinated";
import type { LiveExecutorSnapshot, LiveOrderRequest } from "./live-executor";
import { ensureKrakenGoldInitialProtection, type GoldProtectionResult } from "./kraken-gold-protection-controller";
import {
  acquireKrakenPrivateLease,
  releaseKrakenPrivateLease,
  startKrakenPrivateLeaseHeartbeat,
} from "./kraken-private-lease";
import { livePreflightCertificateStorageKey } from "./live-preflight-certificate-store";
import type { Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const JOURNAL_STORAGE_PREFIX = "live-submission-journal-v1:";

interface PrepareValidationBody {
  eurBalance: number;
  request: LiveOrderRequest;
}

interface ReconciliationPayload {
  state?: LiveExecutorSnapshot;
  [key: string]: unknown;
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

function protectionRequired(state: LiveExecutorSnapshot, liveEnabled: boolean): boolean {
  return liveEnabled && state.inventory.quantityBase > 1e-9;
}

/**
 * El cambio de XBTEUR a PAXGEUR puede dejar una propuesta validate-only antigua
 * en Durable Object. Solo se elimina automáticamente cuando existe evidencia
 * local de que nunca fue enviada, ejecutada ni conciliada. Cualquier rastro de
 * journal o inventario mantiene el estado bloqueado y exige revisión.
 *
 * Además, después de una reconciliación LIVE exitosa, cualquier inventario real
 * de oro debe quedar protegido por un stop-loss Kraken confirmado. Si no puede
 * confirmarse, se activa fail-closed y se bloquean nuevas operaciones.
 */
export class GoldLiveExecutorState extends CoordinatedLiveExecutorState {
  private async nextGoldNonce(): Promise<string> {
    const botState = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName("singleton"));
    const response = await botState.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`No se pudo obtener nonce para protección: HTTP ${response.status}`);
    const body = await response.json() as { nonce?: unknown };
    if (typeof body.nonce !== "string" || !body.nonce) throw new Error("Nonce Kraken de protección inválido");
    return body.nonce;
  }

  private async failClosedProtection(state: LiveExecutorSnapshot, reason: string): Promise<void> {
    state.emergencyStopActive = true;
    state.emergencyStopReason = reason;
    state.emergencyStopRequiresManualLiquidation = state.inventory.quantityBase > 1e-9;
    state.updatedAt = Date.now();
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private async protectReconciledInventory(
    state: LiveExecutorSnapshot,
  ): Promise<GoldProtectionResult> {
    if (!this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
      return {
        ok: false,
        status: "blocked",
        record: null,
        blocker: "Credenciales Kraken ausentes al proteger inventario real",
      };
    }

    let leaseId: string;
    try {
      leaseId = await acquireKrakenPrivateLease(this.env, `gold-protection:${crypto.randomUUID()}`);
    } catch (error) {
      return {
        ok: false,
        status: "blocked",
        record: null,
        blocker: error instanceof Error ? error.message : "Concesión privada Kraken no disponible para protección",
      };
    }

    const heartbeat = startKrakenPrivateLeaseHeartbeat(this.env, leaseId);
    try {
      const result = await ensureKrakenGoldInitialProtection({
        state,
        configuredPair: this.env.PAIR || "PAXGEUR",
        apiKey: this.env.KRAKEN_API_KEY,
        apiSecret: this.env.KRAKEN_API_SECRET,
        nextNonce: () => this.nextGoldNonce(),
        storage: this.ctx.storage,
      });
      const renewalFailure = heartbeat.failure();
      if (renewalFailure) {
        return {
          ok: false,
          status: "blocked",
          record: result.record,
          blocker: `Protección no certificable: ${renewalFailure.message}`,
        };
      }
      return result;
    } finally {
      heartbeat.stop();
      await releaseKrakenPrivateLease(this.env, leaseId).catch(() => undefined);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/reconcile") {
      const response = await super.fetch(request);
      if (!response.ok) return response;

      let payload: ReconciliationPayload;
      try {
        payload = await response.clone().json<ReconciliationPayload>();
      } catch {
        return Response.json(
          {
            error: "Reconciliación LIVE devolvió una respuesta no interpretable",
            goldProtection: { ok: false, status: "blocked" },
          },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }

      const state = payload.state;
      if (!state) return response;
      const liveEnabled = this.env.LIVE_TRADING_ENABLED === "true";
      if (!protectionRequired(state, liveEnabled)) {
        return Response.json(
          {
            ...payload,
            goldProtection: {
              ok: true,
              status: "not-required",
              detail: liveEnabled ? "Sin inventario real que proteger" : "LIVE desactivado",
            },
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const protection = await this.protectReconciledInventory(state);
      if (!protection.ok) {
        await this.failClosedProtection(state, `PAXG_PROTECTION_NOT_CONFIRMED: ${protection.blocker}`);
        return Response.json(
          { ...payload, state, goldProtection: protection, liveTrading: false },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }

      return Response.json(
        { ...payload, goldProtection: protection },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

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
