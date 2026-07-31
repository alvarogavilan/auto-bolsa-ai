import {
  defaultLiveGuardrailConfig,
  evaluateLiveGuardrails,
  type LiveGuardrailConfig,
  type LiveGuardrailContext,
  type LiveGuardrailResult,
  type LiveOrderIntent,
} from "./live-guardrails";
import type { LiveOrderTransport, LiveTransportOrderState } from "./live-transport";

const EPSILON = 1e-9;

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export type LiveOrderStatus =
  | "prepared"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "reconciliation_required";

export type LiveOrderSide = "buy" | "sell";

const TERMINAL_STATUSES: ReadonlySet<LiveOrderStatus> = new Set(["filled", "cancelled", "rejected"]);

const ALLOWED_TRANSITIONS: Record<LiveOrderStatus, readonly LiveOrderStatus[]> = {
  prepared: ["submitted", "rejected", "reconciliation_required", "cancelled"],
  submitted: ["partially_filled", "filled", "cancelled", "rejected", "reconciliation_required"],
  partially_filled: ["filled", "cancelled", "reconciliation_required"],
  reconciliation_required: ["submitted", "partially_filled", "filled", "cancelled", "rejected"],
  filled: [],
  cancelled: [],
  rejected: [],
};

export const MAX_SUBMISSION_ATTEMPTS = 5;

export interface LiveOrderRequest {
  idempotencyKey: string;
  pair: string;
  side: LiveOrderSide;
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
}

export interface LiveOrderTransitionRecord {
  status: LiveOrderStatus;
  at: number;
  reason: string;
  evidence?: unknown;
}

export interface LiveOrder {
  clOrdId: string;
  idempotencyKey: string;
  exchangeOrderId: string | null;
  request: LiveOrderRequest;
  status: LiveOrderStatus;
  filledVolumeBase: number;
  averageFillPrice: number | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  transitions: LiveOrderTransitionRecord[];
}

export interface LiveAuditEntry {
  sequence: number;
  at: number;
  clOrdId: string | null;
  event: string;
  detail: string;
}

/**
 * Inventario real del único activo que puede sostenerse a la vez. Sustituye a
 * un booleano `hasOpenPosition`: un fill parcial cancelado deja cantidad
 * realmente en cartera, y eso debe reflejarse aunque la orden que lo produjo
 * termine en `cancelled`, no solo cuando termina en `filled`.
 */
export interface LiveInventory {
  pair: string | null;
  quantityBase: number;
  averageCostEur: number | null;
  /** Cantidad ya comprometida por una orden de cierre en curso. */
  reservedQuantityBase: number;
}

export interface LiveExecutorSnapshot {
  schemaVersion: "live-executor-snapshot-v1";
  createdAt: number;
  updatedAt: number;
  orders: Record<string, LiveOrder>;
  idempotencyIndex: Record<string, string>;
  activeClOrdId: string | null;
  inventory: LiveInventory;
  dayKey: string;
  dayStartEquityEur: number;
  currentEquityEur: number;
  peakEquityEur: number;
  consecutiveTransportErrors: number;
  lastMarketDataAt: number | null;
  emergencyStopActive: boolean;
  emergencyStopReason: string | null;
  /** Verdadero si, tras una parada de emergencia, queda inventario sin liquidar. */
  emergencyStopRequiresManualLiquidation: boolean;
  nextAuditSequence: number;
  auditLog: LiveAuditEntry[];
}

export type PrepareOrderResult =
  | { ok: true; state: LiveExecutorSnapshot; order: LiveOrder; deduplicated: boolean }
  | { ok: false; state: LiveExecutorSnapshot; blockers: string[] };

export type SubmitOrderResult =
  | { ok: true; state: LiveExecutorSnapshot; order: LiveOrder }
  | { ok: false; state: LiveExecutorSnapshot; order: LiveOrder; blockers: string[] };

const MAX_AUDIT_LOG_ENTRIES = 500;

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function initializeLiveExecutor(initialEquityEur: number, now = Date.now()): LiveExecutorSnapshot {
  return {
    schemaVersion: "live-executor-snapshot-v1",
    createdAt: now,
    updatedAt: now,
    orders: {},
    idempotencyIndex: {},
    activeClOrdId: null,
    inventory: { pair: null, quantityBase: 0, averageCostEur: null, reservedQuantityBase: 0 },
    dayKey: utcDay(now),
    dayStartEquityEur: initialEquityEur,
    currentEquityEur: initialEquityEur,
    peakEquityEur: initialEquityEur,
    consecutiveTransportErrors: 0,
    lastMarketDataAt: null,
    emergencyStopActive: false,
    emergencyStopReason: null,
    emergencyStopRequiresManualLiquidation: false,
    nextAuditSequence: 1,
    auditLog: [],
  };
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

/** Registra una lectura de precio/equity. Reinicia el ancla diaria en el cambio de día UTC. */
export function observeMarket(state: LiveExecutorSnapshot, equityEur: number, now = Date.now()): void {
  const today = utcDay(now);
  if (today !== state.dayKey) {
    state.dayKey = today;
    state.dayStartEquityEur = equityEur;
  }
  state.currentEquityEur = equityEur;
  state.peakEquityEur = Math.max(state.peakEquityEur, equityEur);
  state.lastMarketDataAt = now;
  state.updatedAt = now;
}

function orderIntentForSide(side: LiveOrderSide): LiveOrderIntent {
  return side === "buy" ? "open" : "close";
}

function guardrailContext(
  state: LiveExecutorSnapshot,
  request: LiveOrderRequest,
  excludeClOrdId: string | null,
): LiveGuardrailContext {
  // La reserva de inventario, si existe, siempre pertenece a la orden activa
  // (única por diseño). Al re-validar esa misma orden en `submit`, su propia
  // reserva no debe restarse de la disponibilidad: se estaría comparando el
  // volumen de la orden contra sí misma y bloqueándola siempre.
  const reservedForAvailability = excludeClOrdId !== null && state.activeClOrdId === excludeClOrdId
    ? 0
    : state.inventory.reservedQuantityBase;
  return {
    orderIntent: orderIntentForSide(request.side),
    pair: request.pair,
    volumeBase: request.volumeBase,
    limitPrice: request.limitPrice,
    notionalEur: request.notionalEur,
    hasActiveOrder: state.activeClOrdId !== null && state.activeClOrdId !== excludeClOrdId,
    inventoryQuantityBase: state.inventory.quantityBase,
    inventoryReservedQuantityBase: reservedForAvailability,
    inventoryPair: state.inventory.pair,
    dayStartEquityEur: state.dayStartEquityEur,
    currentEquityEur: state.currentEquityEur,
    peakEquityEur: state.peakEquityEur,
    consecutiveTransportErrors: state.consecutiveTransportErrors,
    lastMarketDataAt: state.lastMarketDataAt,
    emergencyStopActive: state.emergencyStopActive,
  };
}

/**
 * Evalúa todas las puertas de riesgo. `excludeClOrdId` permite re-evaluar en
 * el momento del envío sin que la propia orden (ya activa desde `prepare`)
 * se autobloquee por el límite estructural de una sola orden.
 */
export function checkLiveGuardrails(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now = Date.now(),
  excludeClOrdId: string | null = null,
): LiveGuardrailResult {
  return evaluateLiveGuardrails(config, guardrailContext(state, request, excludeClOrdId), now);
}

/**
 * Crea (o recupera de forma idempotente) una orden `prepared`. Nunca contacta con el
 * transporte: solo reserva el hueco estructural y genera el `cl_ord_id`.
 */
export function prepareOrder(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now = Date.now(),
): PrepareOrderResult {
  const existingClOrdId = state.idempotencyIndex[request.idempotencyKey];
  if (existingClOrdId) {
    const existing = state.orders[existingClOrdId];
    if (existing) {
      appendAudit(state, "order_prepare_deduplicated", `idempotencyKey=${request.idempotencyKey}`, existing.clOrdId, now);
      return { ok: true, state, order: existing, deduplicated: true };
    }
  }

  const result = checkLiveGuardrails(state, config, request, now);
  if (!result.allowed) {
    appendAudit(state, "order_prepare_blocked", result.blockers.join("; "), null, now);
    return { ok: false, state, blockers: result.blockers };
  }

  // UUID estándar sin prefijo: Kraken exige `cl_ord_id` como identificador de
  // texto libre acotado, y un prefijo añadido lo alarga innecesariamente.
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
    transitions: [{ status: "prepared", at: now, reason: "Orden preparada tras superar las puertas de riesgo" }],
  };

  state.orders[clOrdId] = order;
  state.idempotencyIndex[request.idempotencyKey] = clOrdId;
  state.activeClOrdId = clOrdId;
  if (orderIntentForSide(request.side) === "close") {
    // Reserva la cantidad que esta orden de cierre pretende vender: el límite
    // de una sola orden activa garantiza que solo hay una reserva a la vez.
    state.inventory.reservedQuantityBase = request.volumeBase;
  }
  appendAudit(state, "order_prepared", `${request.side} ${request.notionalEur} EUR ${request.pair}`, clOrdId, now);
  return { ok: true, state, order, deduplicated: false };
}

function transition(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  next: LiveOrderStatus,
  reason: string,
  now: number,
  evidence?: unknown,
): void {
  if (order.status === next) return;
  if (!ALLOWED_TRANSITIONS[order.status].includes(next)) {
    appendAudit(
      state,
      "invalid_transition_ignored",
      `${order.status} -> ${next} rechazada (${reason})`,
      order.clOrdId,
      now,
    );
    return;
  }

  order.status = next;
  order.updatedAt = now;
  order.transitions.push({ status: next, at: now, reason, evidence });
  appendAudit(state, `order_${next}`, reason, order.clOrdId, now);

  if (TERMINAL_STATUSES.has(next)) {
    if (state.activeClOrdId === order.clOrdId) state.activeClOrdId = null;
    if (orderIntentForSide(order.request.side) === "close") {
      // Libera la reserva de inventario tanto si la venta se completó como si
      // se canceló o fue rechazada: en cualquier caso deja de estar "en vuelo".
      state.inventory.reservedQuantityBase = 0;
    }
  }
}

/**
 * Aplica el delta de ejecución al inventario real, no al estado de la orden.
 * Se llama con la cantidad ejecutada acumulada más reciente conocida por el
 * exchange, independientemente de si la orden termina `filled`,
 * `partially_filled` o incluso `cancelled` tras un fill parcial: ese
 * inventario ya existe y no puede perderse silenciosamente.
 */
function applyFillDelta(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  newFilledVolumeBase: number,
  newAveragePrice: number | null,
): void {
  const delta = newFilledVolumeBase - order.filledVolumeBase;
  order.filledVolumeBase = newFilledVolumeBase;
  if (newAveragePrice !== null) order.averageFillPrice = newAveragePrice;
  if (delta <= EPSILON) return;

  const inventory = state.inventory;
  const fillPrice = newAveragePrice ?? order.request.limitPrice;
  if (order.request.side === "buy") {
    const priorCost = inventory.quantityBase * (inventory.averageCostEur ?? 0);
    const newQuantity = money(inventory.quantityBase + delta);
    inventory.averageCostEur = newQuantity > EPSILON ? (priorCost + delta * fillPrice) / newQuantity : null;
    inventory.quantityBase = newQuantity;
    inventory.pair = order.request.pair;
  } else {
    inventory.quantityBase = Math.max(0, money(inventory.quantityBase - delta));
    if (inventory.quantityBase <= EPSILON) {
      inventory.quantityBase = 0;
      inventory.averageCostEur = null;
      inventory.pair = null;
    }
  }
}

/** Envía (o reenvía de forma idempotente) una orden `prepared`/`reconciliation_required` al transporte. */
export async function submitOrder(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  config: LiveGuardrailConfig,
  clOrdId: string,
  now = Date.now(),
): Promise<SubmitOrderResult> {
  const order = state.orders[clOrdId];
  if (!order) throw new Error(`Orden desconocida: ${clOrdId}`);

  if (!config.liveTradingEnabled) {
    appendAudit(state, "submission_blocked_kill_switch", "LIVE_TRADING_ENABLED no está activado", clOrdId, now);
    return { ok: false, state, order, blockers: ["LIVE_TRADING_ENABLED no está activado"] };
  }

  if (order.status !== "prepared" && order.status !== "reconciliation_required") {
    // Reintento idempotente: la orden ya progresó, no hay nada que reenviar.
    return { ok: true, state, order };
  }

  // Entre `prepare` y `submit` pueden haber caducado los datos de mercado,
  // haberse alcanzado la pérdida diaria/drawdown, o haberse activado una
  // parada de emergencia. Se re-evalúan todas las puertas justo antes de
  // enviar, excluyendo el bloqueo por "orden activa" de esta misma orden.
  const revalidation = checkLiveGuardrails(state, config, order.request, now, order.clOrdId);
  if (!revalidation.allowed) {
    transition(
      state,
      order,
      "cancelled",
      `Bloqueada antes de enviar: ${revalidation.blockers.join("; ")}`,
      now,
    );
    return { ok: false, state, order, blockers: revalidation.blockers };
  }

  if (order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
    appendAudit(state, "submission_retry_limit_reached", `${order.attempts} intentos agotados`, clOrdId, now);
    return { ok: false, state, order, blockers: ["Límite de reintentos de envío agotado"] };
  }

  order.attempts += 1;

  let ack;
  try {
    ack = await transport.createOrder({
      clOrdId: order.clOrdId,
      pair: order.request.pair,
      side: order.request.side,
      volumeBase: String(order.request.volumeBase),
      limitPrice: String(order.request.limitPrice),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeout o fallo desconocido del transporte";
    state.consecutiveTransportErrors += 1;
    transition(state, order, "reconciliation_required", `Fallo de transporte al enviar: ${message}`, now);
    return { ok: false, state, order, blockers: [message] };
  }

  if (ack.kind === "accepted" && ack.exchangeOrderId) {
    order.exchangeOrderId = ack.exchangeOrderId;
    state.consecutiveTransportErrors = 0;
    transition(state, order, "submitted", "Confirmada por el transporte", now, ack.raw);
    return { ok: true, state, order };
  }

  if (ack.kind === "rejected") {
    state.consecutiveTransportErrors = 0;
    const reason = typeof ack.raw === "object" && ack.raw && "reason" in ack.raw
      ? String((ack.raw as { reason?: unknown }).reason)
      : "Rechazada por el transporte";
    transition(state, order, "rejected", reason, now, ack.raw);
    return { ok: false, state, order, blockers: [reason] };
  }

  // Respuesta inesperada/ininteligible: nunca se asume éxito ni fallo.
  state.consecutiveTransportErrors += 1;
  transition(state, order, "reconciliation_required", "Respuesta del transporte no reconocida", now, ack.raw);
  return { ok: false, state, order, blockers: ["Respuesta del transporte no reconocida"] };
}

function statusFromRemote(remote: LiveTransportOrderState): LiveOrderStatus | null {
  if (remote.status === "canceled") return "cancelled";
  if (remote.status === "closed") return remote.volumeExecutedBase > 0 ? "filled" : "rejected";
  if (remote.status === "open") return remote.volumeExecutedBase > 0 ? "partially_filled" : "submitted";
  return null;
}

function applyRemoteTruth(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  remote: LiveTransportOrderState,
  now: number,
): void {
  // Siempre se fija, no solo la primera vez: cubre tanto la reconciliación
  // habitual (ya lo tenía) como el caso de `retryReconciliation` en el que se
  // acaba de localizar la orden por `cl_ord_id` y `exchangeOrderId` era null.
  order.exchangeOrderId = remote.exchangeOrderId;
  applyFillDelta(state, order, remote.volumeExecutedBase, remote.averagePrice);
  const nextStatus = statusFromRemote(remote);
  if (!nextStatus) {
    appendAudit(state, "reconciliation_unresolved", "El transporte devolvió un estado remoto no reconocido", order.clOrdId, now);
    return;
  }
  transition(state, order, nextStatus, "Reconciliada con el estado remoto del exchange", now, remote);
}

const RECONCILE_BALANCE_TOLERANCE_BASE = 1e-6;

function baseAssetFromPair(pair: string): string | null {
  return pair.endsWith("EUR") ? pair.slice(0, -3) : null;
}

/**
 * Contrasta el inventario derivado de los fills contra el balance real de
 * Kraken para el activo base. Prueba las variantes de código de activo que
 * usa Kraken (con y sin prefijo `X`) porque no todos los pares las usan por
 * igual. Sin ninguna clave reconocible en `balances`, no hay evidencia para
 * contradecir el inventario local, así que se reporta consistente.
 */
export function reconcileInventoryAgainstBalances(
  inventory: LiveInventory,
  balances: Record<string, string>,
  toleranceBase = RECONCILE_BALANCE_TOLERANCE_BASE,
): { consistent: boolean; observedBalance: number | null } {
  if (!inventory.pair) return { consistent: true, observedBalance: null };
  const asset = baseAssetFromPair(inventory.pair);
  if (!asset) return { consistent: true, observedBalance: null };

  for (const key of [asset, `X${asset}`, `XX${asset}`]) {
    const raw = balances[key];
    if (raw === undefined) continue;
    const observed = Number(raw);
    if (!Number.isFinite(observed)) continue;
    return { consistent: Math.abs(observed - inventory.quantityBase) <= toleranceBase, observedBalance: observed };
  }
  return { consistent: true, observedBalance: null };
}

/**
 * Contrasta cada orden no terminal contra las órdenes abiertas/cerradas
 * remotas, y el inventario derivado contra el balance real. La reconciliación
 * de fills/operaciones individuales (TradesHistory) queda fuera de esta
 * versión desactivada; ver docs/live-executor.md.
 */
export async function reconcile(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  now = Date.now(),
): Promise<LiveExecutorSnapshot> {
  const [open, closed] = await Promise.all([transport.listOpenOrders(), transport.listClosedOrders()]);
  const byExchangeId = new Map<string, LiveTransportOrderState>();
  for (const remote of [...open, ...closed]) byExchangeId.set(remote.exchangeOrderId, remote);

  for (const order of Object.values(state.orders)) {
    if (TERMINAL_STATUSES.has(order.status)) continue;
    if (!order.exchangeOrderId) continue;

    const remote = byExchangeId.get(order.exchangeOrderId);
    if (!remote) {
      state.consecutiveTransportErrors += 1;
      transition(state, order, "reconciliation_required", "No aparece en abiertas ni cerradas remotas", now);
      continue;
    }
    state.consecutiveTransportErrors = 0;
    applyRemoteTruth(state, order, remote, now);
  }

  const balances = await transport.fetchBalances().catch(() => null);
  if (balances) {
    const check = reconcileInventoryAgainstBalances(state.inventory, balances);
    if (!check.consistent) {
      state.consecutiveTransportErrors += 1;
      appendAudit(
        state,
        "balance_mismatch_detected",
        `Inventario local=${state.inventory.quantityBase}, balance observado=${check.observedBalance}`,
        null,
        now,
      );
      for (const order of Object.values(state.orders)) {
        if (!TERMINAL_STATUSES.has(order.status)) {
          transition(state, order, "reconciliation_required", "Discrepancia de balance detectada", now);
        }
      }
    }
  }

  state.updatedAt = now;
  return state;
}

/** Reintenta una orden en `reconciliation_required`: reenvía si nunca obtuvo id remoto, o consulta si sí lo tiene. */
export async function retryReconciliation(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  config: LiveGuardrailConfig,
  clOrdId: string,
  now = Date.now(),
): Promise<LiveExecutorSnapshot> {
  const order = state.orders[clOrdId];
  if (!order || order.status !== "reconciliation_required") return state;

  if (!order.exchangeOrderId) {
    // Nunca reenviar a ciegas: si la orden original llegó a procesarse en el
    // exchange (el timeout fue solo en la respuesta), reenviar con el mismo
    // cl_ord_id debería ser idempotente, pero no hay garantía universal de
    // ello. Antes de intentarlo, se busca explícitamente por cl_ord_id.
    const remote = await transport.findByClOrdId(order.clOrdId);
    if (remote) {
      state.consecutiveTransportErrors = 0;
      appendAudit(state, "reconciliation_found_by_cl_ord_id", "Orden localizada por cl_ord_id antes de reenviar", clOrdId, now);
      applyRemoteTruth(state, order, remote, now);
      return state;
    }
    await submitOrder(state, transport, config, clOrdId, now);
    return state;
  }

  if (order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
    appendAudit(state, "reconciliation_retry_limit_reached", `${order.attempts} intentos agotados`, clOrdId, now);
    return state;
  }
  order.attempts += 1;

  const remote = await transport.queryOrder(order.exchangeOrderId);
  if (!remote) {
    appendAudit(state, "reconciliation_still_missing", "El transporte sigue sin conocer la orden", clOrdId, now);
    return state;
  }
  applyRemoteTruth(state, order, remote, now);
  return state;
}

/**
 * Cancelación de emergencia: cancela cualquier orden no terminal y activa la
 * parada estructural. NO liquida una posición ya ejecutada: si al terminar
 * queda inventario (`state.inventory.quantityBase > 0`), se marca
 * `emergencyStopRequiresManualLiquidation = true` para que quede explícito
 * que hace falta una decisión y una ruta de cierre real, reconciliada, no
 * automática. "Cierre conservador" aquí significa únicamente "dejar de
 * intentar operar", nunca "vender lo que ya se compró".
 */
export async function emergencyCancelAll(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  reason: string,
  now = Date.now(),
): Promise<LiveExecutorSnapshot> {
  state.emergencyStopActive = true;
  state.emergencyStopReason = reason;
  appendAudit(state, "emergency_stop_activated", reason, null, now);

  for (const order of Object.values(state.orders)) {
    if (TERMINAL_STATUSES.has(order.status)) continue;
    if (!order.exchangeOrderId) {
      transition(state, order, "cancelled", `Cierre conservador (${reason})`, now);
      continue;
    }
    try {
      const result = await transport.cancelOrder(order.exchangeOrderId);
      if (result.cancelled) {
        transition(state, order, "cancelled", `Cierre conservador (${reason})`, now);
      } else {
        // Puede que ya se haya llenado en el exchange justo antes de cancelar: reconciliar en vez de asumir.
        const remote = await transport.queryOrder(order.exchangeOrderId);
        if (remote) applyRemoteTruth(state, order, remote, now);
        else transition(state, order, "reconciliation_required", "Cancelación de emergencia sin confirmación", now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fallo desconocido cancelando en emergencia";
      transition(state, order, "reconciliation_required", `Fallo cancelando en emergencia: ${message}`, now);
    }
  }

  state.emergencyStopRequiresManualLiquidation = state.inventory.quantityBase > EPSILON;
  if (state.emergencyStopRequiresManualLiquidation) {
    appendAudit(
      state,
      "emergency_stop_leaves_open_inventory",
      `Quedan ${state.inventory.quantityBase} en inventario de ${state.inventory.pair}: requiere revisión y cierre manual`,
      null,
      now,
    );
  }

  state.updatedAt = now;
  return state;
}

/** Despeja la parada de emergencia. Requiere que un humano haya revisado el inventario pendiente. */
export function clearEmergencyStop(state: LiveExecutorSnapshot, reason: string, now = Date.now()): void {
  state.emergencyStopActive = false;
  state.emergencyStopReason = null;
  state.emergencyStopRequiresManualLiquidation = false;
  appendAudit(state, "emergency_stop_cleared", reason, null, now);
  state.updatedAt = now;
}

export function defaultConfigForSnapshot(): LiveGuardrailConfig {
  return defaultLiveGuardrailConfig();
}
