import type {
  LiveExecutorSnapshot,
  LiveOrder,
  LiveOrderStatus,
} from "./live-executor";
import type { LiveGuardrailConfig } from "./live-guardrails";
import type { LivePairResolution } from "./live-pair-metadata";
import { reconcileWithVerifiedFillsTransactional } from "./live-transactional-reconciliation";
import type { LiveOrderTransport } from "./live-transport";
import type {
  LiveFillEvidenceSource,
  LiveVerifiedReconciliationReport,
} from "./live-verified-reconciliation";

const EPSILON = 1e-9;
const MAX_AUDIT_LOG_ENTRIES = 500;
const TERMINAL_STATUSES: ReadonlySet<LiveOrderStatus> = new Set(["filled", "cancelled", "rejected"]);

export interface EmergencyCancellationAttempt {
  clOrdId: string;
  exchangeOrderId: string | null;
  result: "cancelled" | "already_terminal_or_filled" | "local_prepared_cancelled" | "ambiguous_without_exchange_id" | "error";
  detail: string;
}

export interface VerifiedEmergencyCancellationReport {
  activatedAt: number;
  reason: string;
  attempts: EmergencyCancellationAttempt[];
  reconciliation: LiveVerifiedReconciliationReport;
  requiresManualLiquidation: boolean;
  message: string;
}

function appendAudit(
  state: LiveExecutorSnapshot,
  event: string,
  detail: string,
  clOrdId: string | null,
  now: number,
): void {
  state.auditLog.push({ sequence: state.nextAuditSequence, at: now, clOrdId, event, detail });
  state.nextAuditSequence += 1;
  if (state.auditLog.length > MAX_AUDIT_LOG_ENTRIES) {
    state.auditLog = state.auditLog.slice(-MAX_AUDIT_LOG_ENTRIES);
  }
}

function cancelPreparedLocally(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  reason: string,
  now: number,
): void {
  if (order.status !== "prepared" || order.exchangeOrderId !== null) return;
  order.status = "cancelled";
  order.updatedAt = now;
  order.transitions.push({
    status: "cancelled",
    at: now,
    reason,
  });
  if (state.activeClOrdId === order.clOrdId) state.activeClOrdId = null;
  if (order.request.side === "sell") state.inventory.reservedQuantityBase = 0;
  appendAudit(state, "order_cancelled", reason, order.clOrdId, now);
}

/**
 * Activa primero la parada, intenta cancelar todas las órdenes conocidas y
 * después ejecuta la reconciliación transaccional. Nunca usa la respuesta de
 * cancelación para inferir inventario: cualquier fill residual debe aparecer
 * en TradesHistory, cuadrar con la orden y coincidir con el balance antes de
 * que el snapshot real acepte un solo delta.
 */
export async function emergencyCancelAllWithVerifiedFills(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  fillSource: LiveFillEvidenceSource,
  config: LiveGuardrailConfig,
  resolution: LivePairResolution,
  reason: string,
  now = Date.now(),
): Promise<VerifiedEmergencyCancellationReport> {
  state.emergencyStopActive = true;
  state.emergencyStopReason = reason;
  appendAudit(state, "emergency_stop_activated", reason, null, now);

  const attempts: EmergencyCancellationAttempt[] = [];
  for (const order of Object.values(state.orders)) {
    if (TERMINAL_STATUSES.has(order.status)) continue;

    if (!order.exchangeOrderId) {
      if (order.status === "prepared" && order.attempts === 0) {
        cancelPreparedLocally(state, order, `Cancelación local segura antes de cualquier envío (${reason})`, now);
        attempts.push({
          clOrdId: order.clOrdId,
          exchangeOrderId: null,
          result: "local_prepared_cancelled",
          detail: "La orden nunca fue enviada y se canceló únicamente en el estado local.",
        });
      } else {
        attempts.push({
          clOrdId: order.clOrdId,
          exchangeOrderId: null,
          result: "ambiguous_without_exchange_id",
          detail: "No hay txid, pero la orden pudo llegar al exchange; se resolverá por cl_ord_id en la reconciliación.",
        });
        appendAudit(
          state,
          "emergency_cancel_ambiguous_without_txid",
          "No se cancela localmente una orden potencialmente enviada sin txid",
          order.clOrdId,
          now,
        );
      }
      continue;
    }

    try {
      const result = await transport.cancelOrder(order.exchangeOrderId);
      attempts.push({
        clOrdId: order.clOrdId,
        exchangeOrderId: order.exchangeOrderId,
        result: result.cancelled ? "cancelled" : "already_terminal_or_filled",
        detail: result.cancelled
          ? "El exchange aceptó la cancelación; el estado final se verificará después."
          : "El exchange no confirmó cancelación; puede estar cerrada o ejecutada y se verificará después.",
      });
      appendAudit(
        state,
        result.cancelled ? "emergency_cancel_requested" : "emergency_cancel_not_confirmed",
        attempts.at(-1)?.detail ?? "Resultado de cancelación registrado",
        order.clOrdId,
        now,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fallo desconocido al cancelar";
      attempts.push({
        clOrdId: order.clOrdId,
        exchangeOrderId: order.exchangeOrderId,
        result: "error",
        detail: message,
      });
      appendAudit(state, "emergency_cancel_error", message, order.clOrdId, now);
    }
  }

  const reconciliation = await reconcileWithVerifiedFillsTransactional(
    state,
    transport,
    fillSource,
    config,
    resolution,
    now + 1,
  );

  const hasPendingReconciliation = Object.values(state.orders).some(
    (order) => order.status === "reconciliation_required",
  );
  const requiresManualLiquidation = state.inventory.quantityBase > EPSILON
    || hasPendingReconciliation
    || !reconciliation.ok;
  state.emergencyStopRequiresManualLiquidation = requiresManualLiquidation;
  state.emergencyStopActive = true;
  state.emergencyStopReason = requiresManualLiquidation
    ? `${reason}. La parada permanece bloqueada hasta resolver inventario o reconciliación.`
    : reason;
  state.updatedAt = now + 1;

  if (state.inventory.quantityBase > EPSILON) {
    appendAudit(
      state,
      "emergency_stop_leaves_verified_inventory",
      `Quedan ${state.inventory.quantityBase} de ${state.inventory.pair}; el residual está respaldado por fills y requiere cierre manual.`,
      null,
      now + 1,
    );
  }
  if (requiresManualLiquidation) {
    appendAudit(
      state,
      "emergency_stop_requires_manual_resolution",
      state.emergencyStopReason,
      null,
      now + 1,
    );
  }

  return {
    activatedAt: now,
    reason,
    attempts,
    reconciliation,
    requiresManualLiquidation,
    message: requiresManualLiquidation
      ? "Cancelación ejecutada; persiste inventario o evidencia pendiente y se exige resolución manual."
      : "Cancelación y reconciliación completadas; la parada sigue activa hasta despeje humano explícito.",
  };
}
