import {
  defaultLiveGuardrailConfig,
  evaluateLiveGuardrails,
  quantizeToDecimals,
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
  /** Resultado de la última reconciliación de balance, o null si nunca se ha ejecutado. */
  lastBalanceCheckStatus: BalanceReconciliationStatus | null;
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
    lastBalanceCheckStatus: null,
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

/** Solo un reintento con una solicitud exactamente idéntica puede reutilizar una idempotencyKey. */
function requestsMatch(a: LiveOrderRequest, b: LiveOrderRequest): boolean {
  return a.pair === b.pair
    && a.side === b.side
    && Math.abs(a.volumeBase - b.volumeBase) < EPSILON
    && Math.abs(a.limitPrice - b.limitPrice) < EPSILON
    && Math.abs(a.notionalEur - b.notionalEur) < EPSILON;
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
    manualLiquidationPending: state.emergencyStopRequiresManualLiquidation,
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

interface PrepareOrderInternalOptions {
  /**
   * Solo `prepareValidationOrder()` fija esto a `true`, y únicamente para la
   * evaluación de guardrails: el interruptor real de `config` nunca se
   * modifica ni se propaga a `submitOrder()`, que sigue leyendo
   * `config.liveTradingEnabled` sin alterar. Todas las demás puertas (par,
   * mínimo, precisión, máximo 5 €, datos frescos, pérdidas, drawdown,
   * emergencia, inventario, orden única) se evalúan exactamente igual en
   * ambos caminos porque comparten la misma llamada a `checkLiveGuardrails`.
   */
  ignoreLiveTradingSwitch: boolean;
  createdEvent: string;
  blockedEvent: string;
  createdReason: string;
}

function prepareOrderInternal(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now: number,
  options: PrepareOrderInternalOptions,
): PrepareOrderResult {
  const existingClOrdId = state.idempotencyIndex[request.idempotencyKey];
  if (existingClOrdId) {
    const existing = state.orders[existingClOrdId];
    if (existing) {
      if (!requestsMatch(existing.request, request)) {
        appendAudit(
          state,
          "idempotency_key_collision_blocked",
          `idempotencyKey=${request.idempotencyKey} reutilizada con una solicitud distinta de la orden ${existing.clOrdId}`,
          existing.clOrdId,
          now,
        );
        return {
          ok: false,
          state,
          blockers: [`La idempotencyKey ya se usó con una solicitud diferente (orden existente ${existing.clOrdId})`],
        };
      }
      appendAudit(state, "order_prepare_deduplicated", `idempotencyKey=${request.idempotencyKey}`, existing.clOrdId, now);
      return { ok: true, state, order: existing, deduplicated: true };
    }
  }

  const guardrailConfig = options.ignoreLiveTradingSwitch ? { ...config, liveTradingEnabled: true } : config;
  const result = checkLiveGuardrails(state, guardrailConfig, request, now);
  if (!result.allowed) {
    appendAudit(state, options.blockedEvent, result.blockers.join("; "), null, now);
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
  appendAudit(state, options.createdEvent, options.createdReason, clOrdId, now);
  return { ok: true, state, order, deduplicated: false };
}

/**
 * Crea (o recupera de forma idempotente) una orden `prepared`. Nunca contacta con el
 * transporte: solo reserva el hueco estructural y genera el `cl_ord_id`. Exige
 * `config.liveTradingEnabled === true`, exactamente como antes: este camino
 * de ejecución real permanece intacto.
 */
export function prepareOrder(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now = Date.now(),
): PrepareOrderResult {
  return prepareOrderInternal(state, config, request, now, {
    ignoreLiveTradingSwitch: false,
    createdEvent: "order_prepared",
    blockedEvent: "order_prepare_blocked",
    createdReason: `${request.side} ${request.notionalEur} EUR ${request.pair}`,
  });
}

/**
 * Camino SEPARADO de `prepareOrder()`, exclusivo para el flujo de validación
 * previa a un piloto real: crea el mismo tipo de orden `prepared` local pero
 * ignora únicamente el bloqueo del interruptor `LIVE_TRADING_ENABLED`
 * (forzándolo a `true` solo dentro de esta evaluación de guardrails, nunca en
 * `config` real). Todas las demás puertas siguen aplicándose sin cambios.
 * Nunca recibe ni usa un transporte: como `prepareOrder()`, es puramente
 * local. `submitOrder()` no se modifica y sigue exigiendo
 * `config.liveTradingEnabled === true` (el valor real, no forzado) antes de
 * enviar cualquier orden creada por este camino, exactamente igual que para
 * una orden creada por `prepareOrder()`.
 */
export function prepareValidationOrder(
  state: LiveExecutorSnapshot,
  config: LiveGuardrailConfig,
  request: LiveOrderRequest,
  now = Date.now(),
): PrepareOrderResult {
  return prepareOrderInternal(state, config, request, now, {
    ignoreLiveTradingSwitch: true,
    createdEvent: "order_prepared_validation_only",
    blockedEvent: "order_prepare_validation_only_blocked",
    createdReason: `[validate-only, nunca enviada] ${request.side} ${request.notionalEur} EUR ${request.pair}: preparación exclusiva para preflight validate=true`,
  });
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
  config: LiveGuardrailConfig,
): void {
  const delta = newFilledVolumeBase - order.filledVolumeBase;
  order.filledVolumeBase = newFilledVolumeBase;
  if (newAveragePrice !== null) order.averageFillPrice = newAveragePrice;
  if (delta <= EPSILON) return;

  // La cantidad base NO se redondea a 6 decimales como el dinero: se
  // cuantiza según `lot_decimals` del par real (8 por defecto si no hay
  // metadatos), igual que exige Kraken para el volumen.
  const lotDecimals = config.pairMetadata[order.request.pair]?.lotDecimals ?? 8;
  const inventory = state.inventory;
  const fillPrice = newAveragePrice ?? order.request.limitPrice;
  if (order.request.side === "buy") {
    const priorCost = inventory.quantityBase * (inventory.averageCostEur ?? 0);
    const newQuantity = quantizeToDecimals(inventory.quantityBase + delta, lotDecimals);
    inventory.averageCostEur = newQuantity > EPSILON ? money((priorCost + delta * fillPrice) / newQuantity) : null;
    inventory.quantityBase = newQuantity;
    inventory.pair = order.request.pair;
  } else {
    inventory.quantityBase = Math.max(0, quantizeToDecimals(inventory.quantityBase - delta, lotDecimals));
    if (inventory.quantityBase <= EPSILON) {
      inventory.quantityBase = 0;
      inventory.averageCostEur = null;
      inventory.pair = null;
    }
  }
}

/**
 * Envía una orden, exclusivamente si está en `prepared`. NUNCA reenvía una
 * orden en `reconciliation_required`: ese estado es ambiguo por definición
 * (no se sabe si el exchange ya la procesó) y solo `retryReconciliation()`
 * —que localiza por `cl_ord_id`/consulta antes de decidir— puede resolverlo.
 * Si algún futuro llamador invoca `submitOrder()` directamente sobre una
 * orden en `reconciliation_required` (saltándose `retryReconciliation`), se
 * bloquea aquí también: nunca se llama a `transport.createOrder()` en ese
 * estado, pase lo que pase por encima.
 */
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

  if (order.status === "reconciliation_required") {
    const reason = "submitOrder() no reenvía una orden en reconciliation_required; solo retryReconciliation() puede resolverla";
    appendAudit(state, "submission_blocked_ambiguous_order", reason, clOrdId, now);
    return { ok: false, state, order, blockers: [reason] };
  }

  if (order.status !== "prepared") {
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
  config: LiveGuardrailConfig,
): void {
  // Siempre se fija, no solo la primera vez: cubre tanto la reconciliación
  // habitual (ya lo tenía) como el caso de `retryReconciliation` en el que se
  // acaba de localizar la orden por `cl_ord_id` y `exchangeOrderId` era null.
  order.exchangeOrderId = remote.exchangeOrderId;
  applyFillDelta(state, order, remote.volumeExecutedBase, remote.averagePrice, config);
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

export type BalanceReconciliationStatus = "consistent" | "inconsistent" | "unknown";

export interface BalanceReconciliationResult {
  status: BalanceReconciliationStatus;
  observedBalance: number | null;
}

/**
 * Contrasta el inventario derivado de los fills contra el balance real de
 * Kraken para el activo base. Prueba las variantes de código de activo que
 * usa Kraken (con y sin prefijo `X`). Un fallo al obtener el balance, o la
 * ausencia de cualquier clave reconocible cuando SÍ hay inventario, es un
 * estado `"unknown"`: nunca se trata como consistente por defecto. Solo se
 * reporta consistente cuando no hay inventario que verificar en absoluto.
 */
export function reconcileInventoryAgainstBalances(
  inventory: LiveInventory,
  balances: Record<string, string> | null,
  toleranceBase = RECONCILE_BALANCE_TOLERANCE_BASE,
): BalanceReconciliationResult {
  if (!inventory.pair) return { status: "consistent", observedBalance: null };
  if (!balances) return { status: "unknown", observedBalance: null };
  const asset = baseAssetFromPair(inventory.pair);
  if (!asset) return { status: "unknown", observedBalance: null };

  for (const key of [asset, `X${asset}`, `XX${asset}`]) {
    const raw = balances[key];
    if (raw === undefined) continue;
    const observed = Number(raw);
    if (!Number.isFinite(observed)) continue;
    return {
      status: Math.abs(observed - inventory.quantityBase) <= toleranceBase ? "consistent" : "inconsistent",
      observedBalance: observed,
    };
  }
  return { status: "unknown", observedBalance: null };
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
  config: LiveGuardrailConfig,
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
    applyRemoteTruth(state, order, remote, now, config);
  }

  const balances = await transport.fetchBalances().catch(() => null);
  const balanceCheck = reconcileInventoryAgainstBalances(state.inventory, balances);
  state.lastBalanceCheckStatus = balanceCheck.status;
  if (balanceCheck.status !== "consistent") {
    // Una discrepancia (o un "no sé") bloquea de inmediato, exista o no una
    // orden activa: dejar la parada supeditada a que haya una orden en curso
    // permitiría seguir acumulando errores sin ninguna orden que reconciliar.
    // También engancha `emergencyStopRequiresManualLiquidation`: sin esto,
    // `clearEmergencyStop` podría despejar la alarma sin que nada exija una
    // reconciliación posterior realmente consistente antes de operar de nuevo.
    state.consecutiveTransportErrors += 1;
    state.emergencyStopActive = true;
    state.emergencyStopRequiresManualLiquidation = true;
    state.emergencyStopReason = balanceCheck.status === "unknown"
      ? `No se pudo confirmar el balance real de ${state.inventory.pair ?? "el activo en inventario"}`
      : `Discrepancia de balance: inventario local=${state.inventory.quantityBase}, balance observado=${balanceCheck.observedBalance}`;
    appendAudit(state, "balance_mismatch_detected", state.emergencyStopReason, null, now);
    for (const order of Object.values(state.orders)) {
      if (!TERMINAL_STATUSES.has(order.status)) {
        transition(state, order, "reconciliation_required", "Discrepancia o ausencia de balance detectada", now);
      }
    }
  }

  state.updatedAt = now;
  return state;
}

/**
 * Reintenta resolver una orden en `reconciliation_required`: si nunca obtuvo
 * `exchangeOrderId`, la busca por `cl_ord_id`; si ya lo tiene, consulta su
 * estado. Nunca reenvía la orden ni llama a `transport.createOrder()` — la
 * única función que puede hacerlo es `submitOrder()`, y esta ni siquiera la
 * invoca.
 */
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
    // Nunca reenviar automáticamente una orden ambigua. Si el exchange la
    // procesó, `findByClOrdId` la localiza y se reconcilia con la verdad
    // remota. Si devuelve null, eso NO demuestra que Kraken no la recibió
    // (puede ser latencia, la ventana limitada de ClosedOrders, o un fallo
    // parcial de listado): la orden permanece en `reconciliation_required` y,
    // agotados los intentos de localización, se exige revisión humana. Jamás
    // se llama de nuevo a `submitOrder` desde aquí.
    const remote = await transport.findByClOrdId(order.clOrdId);
    if (remote) {
      state.consecutiveTransportErrors = 0;
      appendAudit(state, "reconciliation_found_by_cl_ord_id", "Orden localizada por cl_ord_id antes de reenviar", clOrdId, now);
      applyRemoteTruth(state, order, remote, now, config);
      return state;
    }

    order.attempts += 1;
    appendAudit(
      state,
      "reconciliation_ambiguous_not_found",
      `Intento ${order.attempts}/${MAX_SUBMISSION_ATTEMPTS}: no localizada por cl_ord_id; no se reenvía`,
      clOrdId,
      now,
    );
    if (order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
      state.emergencyStopActive = true;
      state.emergencyStopReason = `Orden ${clOrdId} en estado ambiguo tras ${order.attempts} intentos de localización: requiere revisión humana`;
      appendAudit(state, "reconciliation_requires_human_review", state.emergencyStopReason, clOrdId, now);
    }
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
  applyRemoteTruth(state, order, remote, now, config);
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
  config: LiveGuardrailConfig,
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
        if (remote) applyRemoteTruth(state, order, remote, now, config);
        else transition(state, order, "reconciliation_required", "Cancelación de emergencia sin confirmación", now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fallo desconocido cancelando en emergencia";
      transition(state, order, "reconciliation_required", `Fallo cancelando en emergencia: ${message}`, now);
    }
  }

  state.emergencyStopRequiresManualLiquidation = state.inventory.quantityBase > EPSILON;
  if (state.emergencyStopRequiresManualLiquidation) {
    // Cualquier verificación de balance previa queda invalidada: la emergencia
    // es motivo suficiente para no confiar en el último "consistent" conocido.
    // Solo una reconciliación posterior a esta parada puede volver a
    // acreditarlo (ver `clearEmergencyStop`).
    state.lastBalanceCheckStatus = null;
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

/**
 * Despeja la alarma activa de la parada de emergencia. NO borra
 * `emergencyStopRequiresManualLiquidation` mientras siga existiendo
 * inventario real o alguna orden en `reconciliation_required`: esa evidencia
 * concreta, no la sola voluntad de "despejar", es lo único que la resuelve.
 */
export function clearEmergencyStop(state: LiveExecutorSnapshot, reason: string, now = Date.now()): void {
  state.emergencyStopActive = false;
  state.emergencyStopReason = null;

  const hasResidualInventory = state.inventory.quantityBase > EPSILON;
  const hasPendingReconciliation = Object.values(state.orders).some((order) => order.status === "reconciliation_required");
  // Si alguna vez se comprobó el balance y no salió "consistent" (o quedó
  // invalidado por una emergencia posterior), solo una reconciliación que sí
  // lo confirme puede levantar el bloqueo: la sola voluntad de "despejar"
  // nunca basta cuando la discrepancia sigue sin resolverse con evidencia
  // real. Un balance ya confirmado consistente SÍ excusa el inventario
  // residual (sostener una posición no es en sí mismo una emergencia), pero
  // nunca excusa una reconciliación de orden todavía pendiente.
  const balanceConfirmed = state.lastBalanceCheckStatus === "consistent";
  const balanceUnresolved = state.lastBalanceCheckStatus !== null && !balanceConfirmed;
  const inventoryUnresolved = hasResidualInventory && !balanceConfirmed;
  if (!inventoryUnresolved && !hasPendingReconciliation && !balanceUnresolved) {
    state.emergencyStopRequiresManualLiquidation = false;
  } else if (state.emergencyStopRequiresManualLiquidation) {
    appendAudit(
      state,
      "manual_liquidation_still_pending",
      "La parada se despeja, pero persiste inventario, reconciliación pendiente o balance sin confirmar: sigue exigiendo revisión manual",
      null,
      now,
    );
  }

  appendAudit(state, "emergency_stop_cleared", reason, null, now);
  state.updatedAt = now;
}

export function defaultConfigForSnapshot(): LiveGuardrailConfig {
  return defaultLiveGuardrailConfig();
}

export interface BaselineCalibrationInput {
  /** Saldo EUR consultado por el servidor a Kraken. Nunca un valor libre del navegador. */
  eurBalance: number;
}

export type BaselineCalibrationResult =
  | { ok: true; state: LiveExecutorSnapshot }
  | { ok: false; state: LiveExecutorSnapshot; blockers: string[] };

/**
 * Calibra `dayStartEquityEur`, `currentEquityEur`, `peakEquityEur` y
 * `lastMarketDataAt` al saldo EUR real consultado a Kraken. Solo puede
 * ejecutarse con el estado exactamente prístino con el que se inicializa un
 * `LiveExecutorSnapshot` nuevo: sin orden activa, sin ninguna orden registrada
 * (lo que también implica que no puede existir ningún journal de envío
 * pendiente, porque una entrada de journal solo se crea para una orden ya
 * preparada y certificada — ver `live-submission-journal.ts`), sin
 * inventario, sin parada de emergencia ni liquidación manual pendiente, y sin
 * una reconciliación de balance previa. Cualquier otro estado falla cerrado:
 * esta función nunca reescribe la equidad de un ejecutor que ya ha operado.
 */
export function calibrateLiveBaseline(
  state: LiveExecutorSnapshot,
  input: BaselineCalibrationInput,
  now = Date.now(),
): BaselineCalibrationResult {
  const blockers: string[] = [];

  if (!Number.isFinite(input.eurBalance) || input.eurBalance <= 0) {
    blockers.push("El saldo EUR consultado a Kraken no es un número finito y positivo");
  }
  if (state.activeClOrdId !== null) {
    blockers.push("Existe una orden activa: el estado no es prístino");
  }
  if (Object.keys(state.orders).length > 0) {
    blockers.push("Ya existen órdenes registradas (o journals asociados): el estado no es prístino");
  }
  if (
    state.inventory.quantityBase > EPSILON
    || state.inventory.pair !== null
    || state.inventory.reservedQuantityBase > EPSILON
  ) {
    blockers.push("Existe inventario registrado: el estado no es prístino");
  }
  if (state.emergencyStopActive || state.emergencyStopRequiresManualLiquidation) {
    blockers.push("Existe una parada de emergencia activa o liquidación manual pendiente");
  }
  if (state.lastBalanceCheckStatus !== null) {
    blockers.push("Ya existe una reconciliación de balance previa: el estado no es prístino");
  }

  if (blockers.length > 0) {
    appendAudit(state, "baseline_calibration_blocked", blockers.join("; "), null, now);
    return { ok: false, state, blockers };
  }

  state.dayKey = utcDay(now);
  state.dayStartEquityEur = input.eurBalance;
  state.currentEquityEur = input.eurBalance;
  state.peakEquityEur = input.eurBalance;
  state.lastMarketDataAt = now;
  state.updatedAt = now;
  appendAudit(
    state,
    "baseline_calibrated",
    `Baseline fijado al saldo EUR real consultado a Kraken: ${input.eurBalance} EUR`,
    null,
    now,
  );
  return { ok: true, state };
}
