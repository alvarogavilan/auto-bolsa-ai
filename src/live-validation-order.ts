import type { LiveGuardrailConfig } from "./live-guardrails";
import {
  checkLiveGuardrails,
  type LiveExecutorSnapshot,
  type LiveOrder,
  type LiveOrderRequest,
  type PrepareOrderResult,
} from "./live-executor";

const MAX_AUDIT_LOG_ENTRIES = 500;
const EPSILON = 1e-9;

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
  state.updatedAt = now;
}

function requestsMatch(left: LiveOrderRequest, right: LiveOrderRequest): boolean {
  return left.pair === right.pair
    && left.side === right.side
    && Math.abs(left.volumeBase - right.volumeBase) < EPSILON
    && Math.abs(left.limitPrice - right.limitPrice) < EPSILON
    && Math.abs(left.notionalEur - right.notionalEur) < EPSILON;
}

export interface ValidationBaselineCalibrationResult {
  ok: boolean;
  state: LiveExecutorSnapshot;
  blockers: string[];
}

/**
 * Calibra el baseline del futuro piloto desde un saldo EUR ya autenticado por
 * el servidor. Solo funciona sobre un estado realmente prístino; nunca acepta
 * un saldo proporcionado por el navegador ni borra evidencia previa.
 */
export function calibratePristineValidationBaseline(
  state: LiveExecutorSnapshot,
  eurBalance: number,
  hasPendingJournal: boolean,
  now = Date.now(),
): ValidationBaselineCalibrationResult {
  const blockers: string[] = [];
  if (!Number.isFinite(eurBalance) || eurBalance <= 0) blockers.push("El saldo EUR autenticado no es válido");
  if (state.activeClOrdId !== null) blockers.push("Existe una orden activa");
  if (Object.keys(state.orders).length > 0) blockers.push("El ejecutor ya contiene órdenes y no puede recalibrarse como prístino");
  if (state.inventory.quantityBase > EPSILON || state.inventory.reservedQuantityBase > EPSILON || state.inventory.pair !== null) {
    blockers.push("Existe inventario o reserva de inventario");
  }
  if (hasPendingJournal) blockers.push("Existe un journal de envío pendiente");
  if (state.emergencyStopActive) blockers.push("La parada de emergencia está activa");
  if (state.emergencyStopRequiresManualLiquidation) blockers.push("Existe liquidación manual pendiente");
  if (state.consecutiveTransportErrors > 0) blockers.push("Existen errores de transporte sin limpiar");

  if (blockers.length > 0) {
    appendAudit(state, "validation_baseline_calibration_blocked", blockers.join("; "), null, now);
    return { ok: false, state, blockers };
  }

  const dayKey = new Date(now).toISOString().slice(0, 10);
  state.dayKey = dayKey;
  state.dayStartEquityEur = eurBalance;
  state.currentEquityEur = eurBalance;
  state.peakEquityEur = eurBalance;
  state.lastMarketDataAt = now;
  state.lastBalanceCheckStatus = "consistent";
  appendAudit(
    state,
    "validation_baseline_calibrated",
    `Baseline validate-only calibrado desde saldo EUR autenticado (${eurBalance})`,
    null,
    now,
  );
  return { ok: true, state, blockers: [] };
}

/**
 * Crea una orden local exclusivamente para Kraken validate=true con LIVE
 * apagado. Ignora solo el kill switch durante esta preparación local; todas
 * las demás guardas siguen activas. No importa ni recibe un transporte.
 */
export function prepareValidationOrder(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now = Date.now(),
): PrepareOrderResult {
  const existingClOrdId = state.idempotencyIndex[request.idempotencyKey];
  if (existingClOrdId) {
    const existing = state.orders[existingClOrdId];
    if (existing) {
      if (!requestsMatch(existing.request, request)) {
        appendAudit(
          state,
          "validation_idempotency_collision_blocked",
          `idempotencyKey=${request.idempotencyKey} reutilizada con payload distinto`,
          existing.clOrdId,
          now,
        );
        return { ok: false, state, blockers: ["La idempotencyKey validate-only ya se utilizó con otra solicitud"] };
      }
      appendAudit(state, "validation_order_prepare_deduplicated", request.idempotencyKey, existing.clOrdId, now);
      return { ok: true, state, order: existing, deduplicated: true };
    }
  }

  const validationConfig: LiveGuardrailConfig = { ...config, liveTradingEnabled: true };
  const guardrails = checkLiveGuardrails(state, validationConfig, request, now);
  if (!guardrails.allowed) {
    appendAudit(state, "validation_order_prepare_blocked", guardrails.blockers.join("; "), null, now);
    return { ok: false, state, blockers: guardrails.blockers };
  }

  const clOrdId = crypto.randomUUID();
  const order: LiveOrder = {
    clOrdId,
    idempotencyKey: request.idempotencyKey,
    exchangeOrderId: null,
    request,
    status: "prepared",
    filledVolumeBase: 0,
    averageFillPrice: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    transitions: [{
      status: "prepared",
      at: now,
      reason: "Preparada localmente solo para Kraken validate=true; el envío LIVE permanece apagado",
    }],
  };

  state.orders[clOrdId] = order;
  state.idempotencyIndex[request.idempotencyKey] = clOrdId;
  state.activeClOrdId = clOrdId;
  appendAudit(
    state,
    "validation_order_prepared",
    `${request.side} ${request.notionalEur} EUR ${request.pair}; validate-only`,
    clOrdId,
    now,
  );
  return { ok: true, state, order, deduplicated: false };
}
