import {
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  reconcile,
  retryReconciliation,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "./live-executor";
import {
  submitOrderWithAtomicPreflightCertificate,
  type AtomicLivePreflightCertificateStore,
} from "./live-certified-submission";
import {
  consumeLivePreflightCertificate,
  createLivePreflightCertificate,
  type LivePreflightCertificate,
} from "./live-preflight-certificate";
import type { LiveOrderPreflightResult } from "./live-order-preflight";
import {
  defaultLiveGuardrailConfig,
  type LiveGuardrailConfig,
} from "./live-guardrails";
import {
  PersistedLiveSubmissionJournal,
  type LiveSubmissionJournalEntry,
} from "./live-submission-journal";
import {
  FakeLiveOrderTransport,
  type LiveOrderTransport,
  type LiveTransportAck,
  type LiveTransportCancelResult,
  type LiveTransportOrderRequest,
  type LiveTransportOrderState,
} from "./live-transport";

export interface PilotFireDrillCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface PilotFireDrillReport {
  schemaVersion: "pilot-fire-drill-v1";
  generatedAt: number;
  passed: boolean;
  passedChecks: number;
  totalChecks: number;
  checks: PilotFireDrillCheck[];
  usesMockTransportOnly: true;
  networkCallsToKraken: 0;
  realOrderCreated: false;
  changesProductionState: false;
  changesTradingDecision: false;
  liveTrading: false;
}

class CountingTransport implements LiveOrderTransport {
  createOrderCalls = 0;

  constructor(readonly inner: FakeLiveOrderTransport) {}

  async createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck> {
    this.createOrderCalls += 1;
    return this.inner.createOrder(request);
  }

  queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null> {
    return this.inner.queryOrder(exchangeOrderId);
  }

  findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null> {
    return this.inner.findByClOrdId(clOrdId);
  }

  cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult> {
    return this.inner.cancelOrder(exchangeOrderId);
  }

  listOpenOrders(): Promise<LiveTransportOrderState[]> {
    return this.inner.listOpenOrders();
  }

  listClosedOrders(): Promise<LiveTransportOrderState[]> {
    return this.inner.listClosedOrders();
  }

  fetchBalances(): Promise<Record<string, string>> {
    return this.inner.fetchBalances();
  }
}

class MemoryCertificateStore implements AtomicLivePreflightCertificateStore {
  constructor(private certificate: LivePreflightCertificate) {}

  async consumeForOrder(
    clOrdId: string,
    request: Readonly<LiveOrderRequest>,
    now: number,
  ) {
    try {
      this.certificate = await consumeLivePreflightCertificate(
        this.certificate,
        clOrdId,
        request,
        now,
      );
      return { ok: true as const, certificate: this.certificate };
    } catch (error) {
      return {
        ok: false as const,
        blockers: [error instanceof Error ? error.message : "Certificado bloqueado"],
      };
    }
  }
}

interface DrillContext {
  state: LiveExecutorSnapshot;
  config: LiveGuardrailConfig;
  request: LiveOrderRequest;
  clOrdId: string;
}

function baseRequest(id: string): LiveOrderRequest {
  return {
    idempotencyKey: `fire-drill:${id}`,
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
  };
}

function createContext(id: string, now: number): DrillContext {
  const state = initializeLiveExecutor(10, now);
  observeMarket(state, 10, now);
  const config = defaultLiveGuardrailConfig({
    liveTradingEnabled: true,
    maxOrderNotionalEur: 5,
    pairMetadata: {
      XBTEUR: { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 },
    },
  });
  const request = baseRequest(id);
  const prepared = prepareOrder(state, config, request, now);
  if (!prepared.ok) throw new Error(`No se pudo preparar el simulacro: ${prepared.blockers.join("; ")}`);
  return { state, config, request, clOrdId: prepared.order.clOrdId };
}

function validatedPreflight(clOrdId: string, checkedAt: number): LiveOrderPreflightResult {
  return {
    status: "validated",
    checkedAt,
    contactedKraken: true,
    validateFlagForced: true,
    matchingEngineSubmission: false,
    realOrderCreated: false,
    clOrdId,
    blockers: [],
    message: "Validación simulada segura",
    description: "buy 0.0001 XBTEUR @ limit 50000",
    anomaly: null,
  };
}

async function certificateFor(
  context: DrillContext,
  now: number,
  ttlMs = 120_000,
): Promise<LivePreflightCertificate> {
  return createLivePreflightCertificate(
    {
      pair: context.request.pair,
      side: context.request.side,
      volumeBase: context.request.volumeBase,
      limitPrice: context.request.limitPrice,
      notionalEur: context.request.notionalEur,
    },
    validatedPreflight(context.clOrdId, now),
    {
      ttlMs,
      certificateIdFactory: () => `fire-drill-certificate:${context.request.idempotencyKey}`,
    },
  );
}

function journalHarness() {
  const entries = new Map<string, LiveSubmissionJournalEntry>();
  const persistence = {
    get: async (key: string) => entries.get(key) ?? null,
    put: async (key: string, value: LiveSubmissionJournalEntry) => {
      entries.set(key, value);
    },
  };
  const criticalSection = { run: <T>(operation: () => Promise<T>) => operation() };
  return {
    entries,
    journal: new PersistedLiveSubmissionJournal(persistence, criticalSection),
    restart: () => new PersistedLiveSubmissionJournal(persistence, criticalSection),
  };
}

async function happyPathAndDuplicate(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("happy", now);
  const transport = new CountingTransport(new FakeLiveOrderTransport());
  const certificate = await certificateFor(context, now);
  const harness = journalHarness();

  const first = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 1,
    harness.journal,
  );
  const second = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 2,
    harness.journal,
  );
  await reconcile(context.state, transport, context.config, now + 3);
  const order = context.state.orders[context.clOrdId];
  const passed = first.ok
    && second.ok
    && transport.createOrderCalls === 1
    && order?.status === "filled"
    && context.state.lastBalanceCheckStatus === "consistent";

  return {
    id: "happy-path-and-double-tap",
    title: "Envío certificado y doble toque idempotente",
    passed,
    detail: passed
      ? "El primer envío simulado se reconcilió y el segundo toque no creó otra orden."
      : "El camino feliz o la protección contra doble toque no se comportó como se esperaba.",
    evidence: {
      createOrderCalls: transport.createOrderCalls,
      firstOk: first.ok,
      secondOk: second.ok,
      finalStatus: order?.status ?? null,
      balanceStatus: context.state.lastBalanceCheckStatus,
    },
  };
}

async function timeoutAfterRemoteAcceptance(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("timeout-after-accept", now);
  const fake = new FakeLiveOrderTransport();
  fake.scriptScenario(context.clOrdId, { kind: "accept-but-report-timeout" });
  const transport = new CountingTransport(fake);
  const certificate = await certificateFor(context, now);
  const harness = journalHarness();

  const submitted = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 1,
    harness.journal,
  );
  const recoveryBeforeRestart = await harness.journal.recoveryDecision(context.clOrdId);
  const recoveryAfterRestart = await harness.restart().recoveryDecision(context.clOrdId);
  await retryReconciliation(context.state, transport, context.config, context.clOrdId, now + 2);
  await reconcile(context.state, transport, context.config, now + 3);
  const order = context.state.orders[context.clOrdId];
  const passed = !submitted.ok
    && transport.createOrderCalls === 1
    && recoveryBeforeRestart.action === "reconcile_only"
    && recoveryAfterRestart.action === "reconcile_only"
    && order?.status === "filled";

  return {
    id: "timeout-after-remote-acceptance",
    title: "Timeout ambiguo después de aceptación remota",
    passed,
    detail: passed
      ? "La orden se localizó por clOrdId y se reconcilió sin reenviarla, incluso tras recrear el journal."
      : "La recuperación ambigua no quedó limitada a reconciliación.",
    evidence: {
      createOrderCalls: transport.createOrderCalls,
      initialStatus: submitted.order.status,
      recoveryBeforeRestart: recoveryBeforeRestart.action,
      recoveryAfterRestart: recoveryAfterRestart.action,
      finalStatus: order?.status ?? null,
    },
  };
}

async function partialFillAndBalanceMismatch(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("partial-fill", now);
  const fake = new FakeLiveOrderTransport();
  fake.scriptScenario(context.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.4 });
  const transport = new CountingTransport(fake);
  const certificate = await certificateFor(context, now);
  const harness = journalHarness();

  const submitted = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 1,
    harness.journal,
  );
  await reconcile(context.state, transport, context.config, now + 2);
  const partialQuantity = context.state.inventory.quantityBase;
  fake.setBalance("XXBT", "0");
  await reconcile(context.state, transport, context.config, now + 3);
  const order = context.state.orders[context.clOrdId];
  const passed = submitted.ok
    && partialQuantity > 0
    && order?.status === "reconciliation_required"
    && context.state.emergencyStopActive
    && context.state.emergencyStopRequiresManualLiquidation
    && context.state.lastBalanceCheckStatus === "inconsistent";

  return {
    id: "partial-fill-balance-mismatch",
    title: "Fill parcial y discrepancia de inventario",
    passed,
    detail: passed
      ? "El inventario parcial se conservó y una discrepancia activó parada y liquidación manual."
      : "El fill parcial o la discrepancia no activaron todas las protecciones.",
    evidence: {
      partialQuantity,
      finalStatus: order?.status ?? null,
      balanceStatus: context.state.lastBalanceCheckStatus,
      emergencyStopActive: context.state.emergencyStopActive,
      manualLiquidationPending: context.state.emergencyStopRequiresManualLiquidation,
    },
  };
}

async function expiredCertificate(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("expired-certificate", now);
  const transport = new CountingTransport(new FakeLiveOrderTransport());
  const certificate = await certificateFor(context, now, 1_000);
  const harness = journalHarness();
  const result = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 1_001,
    harness.journal,
  );
  const passed = !result.ok
    && transport.createOrderCalls === 0
    && result.order.status === "prepared"
    && result.preflightCertificateConsumed === false;

  return {
    id: "expired-certificate",
    title: "Certificado caducado",
    passed,
    detail: passed
      ? "El certificado caducado bloqueó antes del journal y del transporte."
      : "Un certificado caducado alcanzó una fase no permitida.",
    evidence: {
      createOrderCalls: transport.createOrderCalls,
      orderStatus: result.order.status,
      certificateConsumed: result.preflightCertificateConsumed,
      blockers: result.blockers,
    },
  };
}

async function mutatedPayload(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("mutated-payload", now);
  const transport = new CountingTransport(new FakeLiveOrderTransport());
  const certificate = await certificateFor(context, now);
  const harness = journalHarness();
  context.state.orders[context.clOrdId]!.request.limitPrice += 1;
  const result = await submitOrderWithAtomicPreflightCertificate(
    context.state,
    transport,
    context.config,
    new MemoryCertificateStore(certificate),
    context.clOrdId,
    now + 1,
    harness.journal,
  );
  const passed = !result.ok
    && transport.createOrderCalls === 0
    && result.preflightCertificateConsumed === false;

  return {
    id: "mutated-certified-payload",
    title: "Payload alterado después del preflight",
    passed,
    detail: passed
      ? "La huella exacta detectó el cambio de precio antes del transporte."
      : "El payload alterado no quedó bloqueado por el certificado.",
    evidence: {
      createOrderCalls: transport.createOrderCalls,
      certificateConsumed: result.preflightCertificateConsumed,
      blockers: result.blockers,
    },
  };
}

async function journalPayloadCollision(now: number): Promise<PilotFireDrillCheck> {
  const context = createContext("journal-collision", now);
  const harness = journalHarness();
  const transportRequest: LiveTransportOrderRequest = {
    clOrdId: context.clOrdId,
    pair: context.request.pair,
    side: context.request.side,
    volumeBase: String(context.request.volumeBase),
    limitPrice: String(context.request.limitPrice),
  };
  const first = await harness.journal.persistIntent(
    context.clOrdId,
    "certificate-a",
    transportRequest,
    context.request,
    now,
  );
  const alteredRequest = { ...context.request, limitPrice: context.request.limitPrice + 10 };
  const alteredTransport = { ...transportRequest, limitPrice: String(alteredRequest.limitPrice) };
  const second = await harness.restart().persistIntent(
    context.clOrdId,
    "certificate-a",
    alteredTransport,
    alteredRequest,
    now + 1,
  );
  const recovery = await harness.restart().recoveryDecision(context.clOrdId);
  const passed = first.ok
    && !second.ok
    && second.blockers.some((item) => item.includes("payload diferente"))
    && recovery.action === "reconcile_only";

  return {
    id: "journal-payload-collision",
    title: "Journal reiniciado y payload distinto",
    passed,
    detail: passed
      ? "El journal persistente rechazó el payload diferente y exigió reconciliación."
      : "El journal no detectó la colisión de payload tras reinicio.",
    evidence: {
      firstPersisted: first.ok,
      secondPersisted: second.ok,
      blockers: second.blockers,
      recoveryAction: recovery.action,
    },
  };
}

async function safeCheck(
  id: string,
  title: string,
  operation: () => Promise<PilotFireDrillCheck>,
): Promise<PilotFireDrillCheck> {
  try {
    return await operation();
  } catch (error) {
    return {
      id,
      title,
      passed: false,
      detail: error instanceof Error ? error.message : "Fallo desconocido del simulacro",
      evidence: { exception: true },
    };
  }
}

/**
 * Ejecuta un ensayo completamente local y efímero. No recibe Env, secretos,
 * Durable Objects ni gateways Kraken; por construcción no puede tocar dinero.
 */
export async function runPilotFireDrill(now = Date.now()): Promise<PilotFireDrillReport> {
  const checks = await Promise.all([
    safeCheck("happy-path-and-double-tap", "Envío certificado y doble toque idempotente", () => happyPathAndDuplicate(now)),
    safeCheck("timeout-after-remote-acceptance", "Timeout ambiguo después de aceptación remota", () => timeoutAfterRemoteAcceptance(now + 10_000)),
    safeCheck("partial-fill-balance-mismatch", "Fill parcial y discrepancia de inventario", () => partialFillAndBalanceMismatch(now + 20_000)),
    safeCheck("expired-certificate", "Certificado caducado", () => expiredCertificate(now + 30_000)),
    safeCheck("mutated-certified-payload", "Payload alterado después del preflight", () => mutatedPayload(now + 40_000)),
    safeCheck("journal-payload-collision", "Journal reiniciado y payload distinto", () => journalPayloadCollision(now + 50_000)),
  ]);
  const passedChecks = checks.filter((check) => check.passed).length;
  return {
    schemaVersion: "pilot-fire-drill-v1",
    generatedAt: now,
    passed: passedChecks === checks.length,
    passedChecks,
    totalChecks: checks.length,
    checks,
    usesMockTransportOnly: true,
    networkCallsToKraken: 0,
    realOrderCreated: false,
    changesProductionState: false,
    changesTradingDecision: false,
    liveTrading: false,
  };
}
