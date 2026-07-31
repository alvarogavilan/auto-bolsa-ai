import {
  MAX_SUBMISSION_ATTEMPTS,
  reconcileInventoryAgainstBalances,
  type LiveExecutorSnapshot,
  type LiveOrder,
  type LiveOrderStatus,
} from "./live-executor";
import {
  reconcileFillEvidence,
  type FillEvidenceResult,
  type LiveTradeExecution,
} from "./live-fill-evidence";
import type { LiveGuardrailConfig } from "./live-guardrails";
import type { LivePairResolution } from "./live-pair-metadata";
import { fetchTradeExecutionsForOrders } from "./kraken-trade-history";
import type { LiveOrderTransport, LiveTransportOrderState } from "./live-transport";

const EPSILON = 1e-9;
const MAX_AUDIT_LOG_ENTRIES = 500;
const TRADE_HISTORY_SAFETY_BUFFER_SECONDS = 5 * 60;

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

export interface LiveFillEvidenceBatch {
  trades: LiveTradeExecution[];
  coverageComplete: boolean;
  pagesFetched: number;
  accountRowsScanned: number;
  totalCount: number | null;
}

export interface LiveFillEvidenceSource {
  fetchForOrders(
    exchangeOrderIds: readonly string[],
    startSeconds: number,
  ): Promise<LiveFillEvidenceBatch>;
}

export class KrakenLiveFillEvidenceSource implements LiveFillEvidenceSource {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  async fetchForOrders(
    exchangeOrderIds: readonly string[],
    startSeconds: number,
  ): Promise<LiveFillEvidenceBatch> {
    return fetchTradeExecutionsForOrders({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      nextNonce: this.nextNonce,
      exchangeOrderIds,
      startSeconds,
    });
  }
}

/** Fuente deliberadamente fail-closed para cualquier composición sin acceso real. */
export class UnavailableLiveFillEvidenceSource implements LiveFillEvidenceSource {
  async fetchForOrders(): Promise<LiveFillEvidenceBatch> {
    return {
      trades: [],
      coverageComplete: false,
      pagesFetched: 0,
      accountRowsScanned: 0,
      totalCount: null,
    };
  }
}

export interface LiveVerifiedReconciliationReport {
  ok: boolean;
  checkedAt: number;
  matchedOrders: number;
  unresolvedOrders: string[];
  fillEvidenceByOrder: Record<string, FillEvidenceResult>;
  pagesFetched: number;
  accountRowsScanned: number;
  historyCoverageComplete: boolean;
  balanceStatus: "consistent" | "inconsistent" | "unknown";
  message: string;
}

interface RemoteSnapshot {
  open: LiveTransportOrderState[];
  closed: LiveTransportOrderState[];
  balances: Record<string, string> | null;
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
    appendAudit(state, "verified_reconciliation_invalid_transition", `${order.status} -> ${next}: ${reason}`, order.clOrdId, now);
    return;
  }

  order.status = next;
  order.updatedAt = now;
  order.transitions.push({ status: next, at: now, reason, evidence });
  appendAudit(state, `order_${next}`, reason, order.clOrdId, now);

  if (TERMINAL_STATUSES.has(next)) {
    if (state.activeClOrdId === order.clOrdId) state.activeClOrdId = null;
    if (order.request.side === "sell") state.inventory.reservedQuantityBase = 0;
  }
}

function statusFromRemote(remote: LiveTransportOrderState): LiveOrderStatus | null {
  if (remote.status === "canceled") return "cancelled";
  if (remote.status === "closed") return remote.volumeExecutedBase > 0 ? "filled" : "rejected";
  if (remote.status === "open") return remote.volumeExecutedBase > 0 ? "partially_filled" : "submitted";
  return null;
}

function quantize(value: number, decimals: number): number {
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? Math.min(decimals, 12) : 8;
  const factor = 10 ** safeDecimals;
  return Math.round(value * factor) / factor;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function applyVerifiedFillDelta(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  remote: LiveTransportOrderState,
  config: LiveGuardrailConfig,
): void {
  const delta = remote.volumeExecutedBase - order.filledVolumeBase;
  if (delta < -EPSILON) {
    throw new Error(`El volumen ejecutado remoto retrocedió para ${order.clOrdId}`);
  }

  order.filledVolumeBase = remote.volumeExecutedBase;
  if (remote.averagePrice !== null) order.averageFillPrice = remote.averagePrice;
  if (delta <= EPSILON) return;

  const lotDecimals = config.pairMetadata[order.request.pair]?.lotDecimals;
  if (lotDecimals === undefined) throw new Error(`Faltan lot_decimals verificados para ${order.request.pair}`);
  const fillPrice = remote.averagePrice ?? order.request.limitPrice;

  if (order.request.side === "buy") {
    const previousCost = state.inventory.quantityBase * (state.inventory.averageCostEur ?? 0);
    const quantity = quantize(state.inventory.quantityBase + delta, lotDecimals);
    state.inventory.quantityBase = quantity;
    state.inventory.averageCostEur = quantity > EPSILON
      ? money((previousCost + delta * fillPrice) / quantity)
      : null;
    state.inventory.pair = order.request.pair;
    return;
  }

  state.inventory.quantityBase = Math.max(0, quantize(state.inventory.quantityBase - delta, lotDecimals));
  if (state.inventory.quantityBase <= EPSILON) {
    state.inventory.quantityBase = 0;
    state.inventory.averageCostEur = null;
    state.inventory.pair = null;
  }
}

function applyVerifiedRemoteTruth(
  state: LiveExecutorSnapshot,
  order: LiveOrder,
  remote: LiveTransportOrderState,
  config: LiveGuardrailConfig,
  now: number,
  fillEvidence: FillEvidenceResult,
): void {
  order.exchangeOrderId = remote.exchangeOrderId;
  applyVerifiedFillDelta(state, order, remote, config);
  const nextStatus = statusFromRemote(remote);
  if (!nextStatus) {
    transition(state, order, "reconciliation_required", "Estado remoto no reconocido tras validar fills", now, remote);
    return;
  }
  transition(
    state,
    order,
    nextStatus,
    "Orden, fills individuales y agregados reconciliados con Kraken",
    now,
    { remote, fillEvidence },
  );
}

function activateEvidenceStop(
  state: LiveExecutorSnapshot,
  order: LiveOrder | null,
  reason: string,
  now: number,
  evidence?: unknown,
): void {
  state.consecutiveTransportErrors += 1;
  state.emergencyStopActive = true;
  state.emergencyStopRequiresManualLiquidation = true;
  state.emergencyStopReason = reason;
  state.lastBalanceCheckStatus = null;
  if (order && !TERMINAL_STATUSES.has(order.status)) {
    transition(state, order, "reconciliation_required", reason, now, evidence);
  }
  appendAudit(state, "fill_evidence_gate_blocked", reason, order?.clOrdId ?? null, now);
}

async function fetchRemoteSnapshot(transport: LiveOrderTransport): Promise<RemoteSnapshot> {
  const [open, closed, balances] = await Promise.all([
    transport.listOpenOrders(),
    transport.listClosedOrders(),
    transport.fetchBalances().catch(() => null),
  ]);
  return { open, closed, balances };
}

function matchingRemote(
  order: LiveOrder,
  byExchangeId: ReadonlyMap<string, LiveTransportOrderState>,
  byClOrdId: ReadonlyMap<string, LiveTransportOrderState>,
): LiveTransportOrderState | null {
  if (order.exchangeOrderId) return byExchangeId.get(order.exchangeOrderId) ?? null;
  return byClOrdId.get(order.clOrdId) ?? null;
}

function evidenceForOrder(
  order: LiveOrder,
  remote: LiveTransportOrderState,
  resolution: LivePairResolution,
  config: LiveGuardrailConfig,
  batch: LiveFillEvidenceBatch,
): FillEvidenceResult {
  const metadata = config.pairMetadata[order.request.pair];
  if (!metadata) {
    return {
      status: "unknown",
      reason: `No hay metadatos verificados para ${order.request.pair}.`,
      summary: {
        tradeIds: [], tradeCount: 0, volumeBase: 0, costQuote: 0, feeQuote: 0,
        averagePrice: null, makerCount: 0, takerCount: 0, unknownLiquidityCount: 0,
        earliestTimestampSeconds: null, latestTimestampSeconds: null,
      },
    };
  }

  return reconcileFillEvidence(
    {
      exchangeOrderId: remote.exchangeOrderId,
      acceptedPairCodes: resolution.acceptedPairCodes,
      side: order.request.side,
      volumeExecutedBase: remote.volumeExecutedBase,
      averagePrice: remote.averagePrice,
      lotDecimals: metadata.lotDecimals,
      priceDecimals: metadata.priceDecimals,
    },
    batch.trades,
    batch.coverageComplete,
  );
}

/**
 * Reconciliación fail-closed. No aplica ni un solo delta de inventario hasta
 * que todas las órdenes remotas localizadas estén respaldadas por fills
 * individuales completos. Después contrasta el inventario resultante con el
 * balance agregado de Kraken.
 */
export async function reconcileWithVerifiedFills(
  state: LiveExecutorSnapshot,
  transport: LiveOrderTransport,
  fillSource: LiveFillEvidenceSource,
  config: LiveGuardrailConfig,
  resolution: LivePairResolution,
  now = Date.now(),
): Promise<LiveVerifiedReconciliationReport> {
  const snapshot = await fetchRemoteSnapshot(transport);
  const remotes = [...snapshot.open, ...snapshot.closed];
  const byExchangeId = new Map(remotes.map((remote) => [remote.exchangeOrderId, remote]));
  const byClOrdId = new Map(
    remotes.filter((remote) => remote.clOrdId !== null).map((remote) => [remote.clOrdId as string, remote]),
  );

  const pending = Object.values(state.orders).filter((order) => !TERMINAL_STATUSES.has(order.status));
  const matched = pending
    .map((order) => ({ order, remote: matchingRemote(order, byExchangeId, byClOrdId) }))
    .filter((entry): entry is { order: LiveOrder; remote: LiveTransportOrderState } => entry.remote !== null);
  const unresolved = pending.filter((order) => matchingRemote(order, byExchangeId, byClOrdId) === null);

  for (const order of unresolved) {
    order.attempts += 1;
    const reason = `La orden ${order.clOrdId} no aparece en abiertas ni cerradas de Kraken`;
    transition(state, order, "reconciliation_required", reason, now);
    appendAudit(state, "verified_reconciliation_order_missing", reason, order.clOrdId, now);
    if (order.attempts >= MAX_SUBMISSION_ATTEMPTS) {
      activateEvidenceStop(state, order, `${reason} tras ${order.attempts} comprobaciones`, now);
    }
  }

  const exchangeOrderIds = [...new Set(matched.map(({ remote }) => remote.exchangeOrderId))];
  const earliestCreatedAt = matched.reduce(
    (minimum, { order }) => Math.min(minimum, order.createdAt),
    now,
  );
  let batch: LiveFillEvidenceBatch;
  try {
    batch = exchangeOrderIds.length === 0
      ? { trades: [], coverageComplete: true, pagesFetched: 0, accountRowsScanned: 0, totalCount: 0 }
      : await fillSource.fetchForOrders(
        exchangeOrderIds,
        Math.max(0, Math.floor(earliestCreatedAt / 1000) - TRADE_HISTORY_SAFETY_BUFFER_SECONDS),
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar TradesHistory";
    for (const { order } of matched) {
      activateEvidenceStop(state, order, `Evidencia de fills no disponible: ${message}`, now);
    }
    state.updatedAt = now;
    return {
      ok: false,
      checkedAt: now,
      matchedOrders: matched.length,
      unresolvedOrders: unresolved.map((order) => order.clOrdId),
      fillEvidenceByOrder: {},
      pagesFetched: 0,
      accountRowsScanned: 0,
      historyCoverageComplete: false,
      balanceStatus: "unknown",
      message: `Reconciliación bloqueada: ${message}`,
    };
  }

  const fillEvidenceByOrder: Record<string, FillEvidenceResult> = {};
  for (const { order, remote } of matched) {
    const evidence = evidenceForOrder(order, remote, resolution, config, batch);
    fillEvidenceByOrder[order.clOrdId] = evidence;
    if (evidence.status !== "consistent") {
      activateEvidenceStop(
        state,
        order,
        `La evidencia individual de ${order.clOrdId} no es verificable: ${evidence.reason}`,
        now,
        evidence,
      );
    }
  }

  const evidenceFailures = Object.values(fillEvidenceByOrder).filter((result) => result.status !== "consistent");
  if (evidenceFailures.length > 0) {
    state.updatedAt = now;
    return {
      ok: false,
      checkedAt: now,
      matchedOrders: matched.length,
      unresolvedOrders: unresolved.map((order) => order.clOrdId),
      fillEvidenceByOrder,
      pagesFetched: batch.pagesFetched,
      accountRowsScanned: batch.accountRowsScanned,
      historyCoverageComplete: batch.coverageComplete,
      balanceStatus: "unknown",
      message: "Reconciliación bloqueada antes de modificar inventario: faltan fills consistentes.",
    };
  }

  for (const { order, remote } of matched) {
    applyVerifiedRemoteTruth(state, order, remote, config, now, fillEvidenceByOrder[order.clOrdId]!);
  }

  const balance = reconcileInventoryAgainstBalances(state.inventory, snapshot.balances);
  state.lastBalanceCheckStatus = balance.status;
  if (balance.status !== "consistent") {
    const reason = balance.status === "unknown"
      ? `No se pudo confirmar el balance real de ${state.inventory.pair ?? "el activo"}`
      : `Discrepancia de balance: inventario local=${state.inventory.quantityBase}, balance observado=${balance.observedBalance}`;
    activateEvidenceStop(state, null, reason, now, balance);
    for (const order of Object.values(state.orders)) {
      if (!TERMINAL_STATUSES.has(order.status)) transition(state, order, "reconciliation_required", reason, now, balance);
    }
  } else if (unresolved.length === 0) {
    state.consecutiveTransportErrors = 0;
  }

  state.updatedAt = now;
  const ok = balance.status === "consistent" && unresolved.length === 0;
  return {
    ok,
    checkedAt: now,
    matchedOrders: matched.length,
    unresolvedOrders: unresolved.map((order) => order.clOrdId),
    fillEvidenceByOrder,
    pagesFetched: batch.pagesFetched,
    accountRowsScanned: batch.accountRowsScanned,
    historyCoverageComplete: batch.coverageComplete,
    balanceStatus: balance.status,
    message: ok
      ? "Órdenes, fills individuales y balance reconciliados de forma consistente."
      : "Reconciliación incompleta; el ejecutor permanece bloqueado o en observación.",
  };
}
