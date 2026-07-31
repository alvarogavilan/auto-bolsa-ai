import type { FillEvidenceResult } from "./live-fill-evidence";
import type { LiveExecutorSnapshot, LiveOrder, LiveOrderStatus } from "./live-executor";
import type { LiveGuardrailConfig } from "./live-guardrails";
import type { LivePairResolution } from "./live-pair-metadata";
import type { LiveOrderTransport } from "./live-transport";
import {
  reconcileWithVerifiedFills,
  type LiveFillEvidenceSource,
  type LiveVerifiedReconciliationReport,
} from "./live-verified-reconciliation";

const MAX_AUDIT_LOG_ENTRIES = 500;
const TERMINAL_STATUSES: ReadonlySet<LiveOrderStatus> = new Set(["filled", "cancelled", "rejected"]);

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

function markReconciliationRequired(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  reason: string,
  now: number,
  evidence?: FillEvidenceResult,
): void {
  if (TERMINAL_STATUSES.has(order.status)) return;
  if (order.status !== "reconciliation_required") {
    order.status = "reconciliation_required";
    order.updatedAt = now;
    order.transitions.push({
      status: "reconciliation_required",
      at: now,
      reason,
      evidence,
    });
  }
  appendAudit(state, "transactional_reconciliation_required", reason, order.clOrdId, now);
}

function commitSnapshot(target: LiveExecutorSnapshot, candidate: LiveExecutorSnapshot): void {
  Object.assign(target, candidate);
}

/**
 * Ejecuta la reconciliación completa sobre una copia. El snapshot real solo
 * recibe inventario, fills y estados terminales si TODO el informe es válido.
 * Ante cualquier fallo se conserva el inventario anterior y únicamente se
 * persisten señales de seguridad y datos de localización no ambiguos.
 */
export async function reconcileWithVerifiedFillsTransactional(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  fillSource: LiveFillEvidenceSource,
  config: LiveGuardrailConfig,
  resolution: LivePairResolution,
  now = Date.now(),
): Promise<LiveVerifiedReconciliationReport> {
  const candidate = structuredClone(state) as LiveExecutorSnapshot;
  let report: LiveVerifiedReconciliationReport;

  try {
    report = await reconcileWithVerifiedFills(
      candidate,
      transport,
      fillSource,
      config,
      resolution,
      now,
    );
  } catch (error) {
    const reason = error instanceof Error
      ? `Reconciliación transaccional abortada: ${error.message}`
      : "Reconciliación transaccional abortada por un error desconocido";
    state.consecutiveTransportErrors += 1;
    state.emergencyStopActive = true;
    state.emergencyStopRequiresManualLiquidation = true;
    state.emergencyStopReason = reason;
    state.lastBalanceCheckStatus = null;
    for (const order of Object.values(state.orders)) {
      if (!TERMINAL_STATUSES.has(order.status)) markReconciliationRequired(state, order, reason, now);
    }
    state.updatedAt = now;
    appendAudit(state, "transactional_reconciliation_exception", reason, null, now);
    return {
      ok: false,
      checkedAt: now,
      matchedOrders: 0,
      unresolvedOrders: Object.values(state.orders)
        .filter((order) => !TERMINAL_STATUSES.has(order.status))
        .map((order) => order.clOrdId),
      fillEvidenceByOrder: {},
      pagesFetched: 0,
      accountRowsScanned: 0,
      historyCoverageComplete: false,
      balanceStatus: "unknown",
      message: reason,
    };
  }

  if (report.ok) {
    commitSnapshot(state, candidate);
    appendAudit(
      state,
      "transactional_reconciliation_committed",
      "Órdenes, fills e inventario confirmados atómicamente tras validar el balance.",
      null,
      now,
    );
    return report;
  }

  // Nunca se copian inventario, cantidades ejecutadas, precio medio ni estados
  // terminales de la copia fallida. Solo se preserva información segura.
  state.consecutiveTransportErrors = Math.max(
    state.consecutiveTransportErrors,
    candidate.consecutiveTransportErrors,
  );
  state.emergencyStopActive = state.emergencyStopActive || candidate.emergencyStopActive;
  state.emergencyStopRequiresManualLiquidation =
    state.emergencyStopRequiresManualLiquidation || candidate.emergencyStopRequiresManualLiquidation;
  if (candidate.emergencyStopReason) state.emergencyStopReason = candidate.emergencyStopReason;
  state.lastBalanceCheckStatus = null;

  const unresolved = new Set(report.unresolvedOrders);
  for (const order of Object.values(state.orders)) {
    if (TERMINAL_STATUSES.has(order.status)) continue;
    const candidateOrder = candidate.orders[order.clOrdId];
    if (candidateOrder) {
      order.attempts = Math.max(order.attempts, candidateOrder.attempts);
      if (!order.exchangeOrderId && candidateOrder.exchangeOrderId) {
        // El txid procede del listado remoto de órdenes y es seguro conservarlo;
        // no implica que aceptemos ningún fill ni saldo.
        order.exchangeOrderId = candidateOrder.exchangeOrderId;
      }
    }

    const evidence = report.fillEvidenceByOrder[order.clOrdId];
    const mustBlock = unresolved.has(order.clOrdId)
      || report.balanceStatus !== "consistent"
      || evidence?.status !== "consistent";
    if (!mustBlock) continue;

    const reason = unresolved.has(order.clOrdId)
      ? `La orden ${order.clOrdId} continúa sin aparecer de forma verificable en Kraken.`
      : evidence && evidence.status !== "consistent"
        ? `Fill no verificable: ${evidence.reason}`
        : `El balance no confirmó el inventario candidato (status=${report.balanceStatus}).`;
    markReconciliationRequired(state, order, reason, now, evidence);
  }

  state.updatedAt = now;
  appendAudit(
    state,
    "transactional_reconciliation_rolled_back",
    `${report.message} Inventario y fills candidatos descartados.`,
    null,
    now,
  );
  return report;
}
