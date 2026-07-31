import { beforeEach, describe, expect, it } from "vitest";
import { defaultLiveGuardrailConfig, type LiveGuardrailConfig } from "../src/live-guardrails";
import {
  emergencyCancelAll,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  reconcile,
  retryReconciliation,
  submitOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "../src/live-executor";
import { FakeLiveOrderTransport } from "../src/live-transport";

const NOW = 1_800_000_000_000;

function buyRequest(idempotencyKey: string, overrides: Partial<LiveOrderRequest> = {}): LiveOrderRequest {
  return {
    idempotencyKey,
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
    ...overrides,
  };
}

function sellRequest(idempotencyKey: string, overrides: Partial<LiveOrderRequest> = {}): LiveOrderRequest {
  return { ...buyRequest(idempotencyKey, overrides), idempotencyKey, side: "sell" };
}

function readyState(now = NOW): LiveExecutorSnapshot {
  const state = initializeLiveExecutor(50, now);
  observeMarket(state, 50, now);
  return state;
}

function enabledConfig(overrides: Partial<LiveGuardrailConfig> = {}): LiveGuardrailConfig {
  return defaultLiveGuardrailConfig({ liveTradingEnabled: true, ...overrides });
}

describe("live executor: structural invariants", () => {
  it("never prepares an order while LIVE_TRADING_ENABLED is absent or false, no matter what else is true", () => {
    const state = readyState();
    const disabledConfig = defaultLiveGuardrailConfig();
    const result = prepareOrder(state, disabledConfig, buyRequest("signal-1"), NOW);
    expect(result.ok).toBe(false);
    expect(Object.keys(state.orders)).toHaveLength(0);
    if (!result.ok) expect(result.blockers).toContain("LIVE_TRADING_ENABLED no está activado");
  });

  it("rejects a request above the 5 EUR default notional cap even when live trading is enabled", () => {
    const state = readyState();
    const result = prepareOrder(state, enabledConfig(), buyRequest("signal-2", { notionalEur: 5.5 }), NOW);
    expect(result.ok).toBe(false);
  });

  it("enforces a single active order and a single open position structurally", () => {
    const state = readyState();
    const config = enabledConfig();
    const first = prepareOrder(state, config, buyRequest("signal-3"), NOW);
    expect(first.ok).toBe(true);

    const second = prepareOrder(state, config, buyRequest("signal-4"), NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.blockers).toContain("Ya existe una orden activa (límite estructural de una sola orden)");
    }
  });
});

describe("live executor: idempotent preparation", () => {
  it("returns the same order for a retried idempotency key instead of creating a duplicate", () => {
    const state = readyState();
    const config = enabledConfig();
    const first = prepareOrder(state, config, buyRequest("signal-dup"), NOW);
    const second = prepareOrder(state, config, buyRequest("signal-dup"), NOW + 1_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.deduplicated).toBe(true);
      expect(second.order.clOrdId).toBe(first.order.clOrdId);
    }
    expect(Object.keys(state.orders)).toHaveLength(1);
  });
});

describe("live executor: submission outcomes", () => {
  let state: LiveExecutorSnapshot;
  let config: LiveGuardrailConfig;

  beforeEach(() => {
    state = readyState();
    config = enabledConfig();
  });

  it("marks an order reconciliation_required after a transport timeout and counts the error", () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("timeout-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "timeout" });

    return submitOrder(state, transport, config, prepared.order.clOrdId, NOW).then((result) => {
      expect(result.ok).toBe(false);
      expect(result.order.status).toBe("reconciliation_required");
      expect(state.consecutiveTransportErrors).toBe(1);
      // El límite de una sola orden activa sigue aplicando: no está resuelto.
      expect(state.activeClOrdId).toBe(prepared.order.clOrdId);
    });
  });

  it("recovers from a timeout on retry, exactly like a flaky gateway that eventually answers", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("retry-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "timeout" });

    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");

    await retryReconciliation(state, transport, config, prepared.order.clOrdId, NOW + 60_000);
    const order = state.orders[prepared.order.clOrdId];
    expect(order?.status).toBe("submitted");
    expect(order?.exchangeOrderId).not.toBeNull();
    expect(state.activeClOrdId).toBe(prepared.order.clOrdId);
  });

  it("marks an unrecognised transport response as reconciliation_required rather than guessing success", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("unknown-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "unknown" });

    const result = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(result.ok).toBe(false);
    expect(result.order.status).toBe("reconciliation_required");
  });

  it("frees the structural slot after an explicit rejection so the next order can be prepared", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("reject-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "reject", reason: "Insufficient funds" });

    const result = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(result.order.status).toBe("rejected");
    expect(state.activeClOrdId).toBeNull();
    expect(state.hasOpenPosition).toBe(false);

    const next = prepareOrder(state, config, buyRequest("reject-signal-2"), NOW + 1_000);
    expect(next.ok).toBe(true);
  });

  it("does not resend an order once it has already progressed past prepared/reconciliation_required", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("no-resend"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");

    const first = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(first.order.status).toBe("submitted");
    const attemptsAfterFirst = first.order.attempts;

    const second = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW + 1_000);
    expect(second.ok).toBe(true);
    expect(second.order.attempts).toBe(attemptsAfterFirst);
  });
});

describe("live executor: partial fills and reconciliation", () => {
  it("moves a partially filled order to filled once reconciliation confirms the remote close", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("partial-signal", { volumeBase: 1 }), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.3 });

    const submitted = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(submitted.order.exchangeOrderId).not.toBeNull();

    await reconcile(state, transport, NOW + 30_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("partially_filled");
    expect(state.hasOpenPosition).toBe(false);

    transport.completeFill(submitted.order.exchangeOrderId!);
    await reconcile(state, transport, NOW + 60_000);
    const finalOrder = state.orders[prepared.order.clOrdId];
    expect(finalOrder?.status).toBe("filled");
    expect(state.hasOpenPosition).toBe(true);
    expect(state.activeClOrdId).toBeNull();
  });

  it("flags an order missing from both open and closed remote lists for reconciliation", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("orphan-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);

    // Simula que el exchange "olvida" la orden entre listados: sustituimos el transporte
    // por uno vacío para la reconciliación mientras conservamos el exchangeOrderId local.
    const emptyTransport = new FakeLiveOrderTransport();
    await reconcile(state, emptyTransport, NOW + 30_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");
    expect(state.consecutiveTransportErrors).toBeGreaterThan(0);
  });
});

describe("live executor: emergency stop", () => {
  it("cancels every non-terminal order, activates the stop, and blocks any further preparation", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("emergency-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "accept-open" });
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);

    await emergencyCancelAll(state, transport, "Prueba de parada de emergencia", NOW + 5_000);

    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
    expect(state.emergencyStopActive).toBe(true);
    expect(state.activeClOrdId).toBeNull();

    const blocked = prepareOrder(state, config, buyRequest("after-emergency"), NOW + 6_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blockers).toContain("Parada de emergencia activa");
  });

  it("cancels a prepared order with no exchange id via a conservative local close", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("never-submitted"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");

    await emergencyCancelAll(state, transport, "Cierre conservador sin envío previo", NOW + 1_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
  });
});

describe("live executor: recovery after restart", () => {
  it("preserves orders, idempotency mapping, and the audit trail across a serialize/deserialize cycle", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("restart-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);

    // Simula la persistencia y recuperación del Durable Object: serializar a JSON y
    // reconstruir el snapshot exactamente como haría `ctx.storage.get` tras reiniciar.
    const restarted = JSON.parse(JSON.stringify(state)) as LiveExecutorSnapshot;

    expect(restarted.orders[prepared.order.clOrdId]?.status).toBe("submitted");
    expect(restarted.idempotencyIndex["restart-signal"]).toBe(prepared.order.clOrdId);
    expect(restarted.auditLog.length).toBe(state.auditLog.length);

    // El reintento idempotente tras el reinicio debe seguir devolviendo la misma orden.
    const retried = prepareOrder(restarted, config, buyRequest("restart-signal"), NOW + 60_000);
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.deduplicated).toBe(true);
      expect(retried.order.clOrdId).toBe(prepared.order.clOrdId);
    }
    expect(Object.keys(restarted.orders)).toHaveLength(1);
  });
});

describe("live executor: closing the single open position", () => {
  it("allows a sell order to close the one open position once it is filled", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();

    const buy = prepareOrder(state, config, buyRequest("close-buy"), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, NOW + 1_000);
    expect(state.hasOpenPosition).toBe(true);
    expect(state.activeClOrdId).toBeNull();

    const sell = prepareOrder(state, config, sellRequest("close-sell"), NOW + 2_000);
    expect(sell.ok).toBe(true);
    if (!sell.ok) throw new Error("expected sell prepare to succeed");
    await submitOrder(state, transport, config, sell.order.clOrdId, NOW + 2_000);
    await reconcile(state, transport, NOW + 3_000);

    expect(state.hasOpenPosition).toBe(false);
    expect(state.orders[sell.order.clOrdId]?.status).toBe("filled");
  });
});
