import { beforeEach, describe, expect, it } from "vitest";
import { defaultLiveGuardrailConfig, type LiveGuardrailConfig } from "../src/live-guardrails";
import {
  clearEmergencyStop,
  emergencyCancelAll,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  reconcile,
  reconcileInventoryAgainstBalances,
  retryReconciliation,
  submitOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "../src/live-executor";
import { FakeLiveOrderTransport } from "../src/live-transport";

const NOW = 1_800_000_000_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const result = prepareOrder(
      state,
      enabledConfig(),
      buyRequest("signal-2", { notionalEur: 5.5, volumeBase: 0.00011 }),
      NOW,
    );
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

  it("generates a plain, prefix-free UUID as cl_ord_id", () => {
    const state = readyState();
    const result = prepareOrder(state, enabledConfig(), buyRequest("uuid-signal"), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.clOrdId).toMatch(UUID_V4);
  });

  it("rejects an incoherent or invalid order request before ever generating a cl_ord_id", () => {
    const state = readyState();
    const config = enabledConfig();
    const badPair = prepareOrder(state, config, buyRequest("bad-pair", { pair: "DOGEEUR", volumeBase: 50 }), NOW);
    expect(badPair.ok).toBe(false);

    const incoherent = prepareOrder(
      state,
      config,
      buyRequest("incoherent", { volumeBase: 1, limitPrice: 50_000, notionalEur: 5 }),
      NOW,
    );
    expect(incoherent.ok).toBe(false);
    expect(Object.keys(state.orders)).toHaveLength(0);
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

  it("blocks, rather than silently reuses, an idempotencyKey replayed with a different payload", () => {
    const state = readyState();
    const config = enabledConfig();
    const first = prepareOrder(state, config, buyRequest("reused-key", { volumeBase: 0.0001, notionalEur: 5 }), NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected first prepare to succeed");

    const differentSide = prepareOrder(state, config, sellRequest("reused-key", { volumeBase: 0.0001, notionalEur: 5 }), NOW + 1_000);
    expect(differentSide.ok).toBe(false);

    const differentVolume = prepareOrder(
      state,
      config,
      buyRequest("reused-key", { volumeBase: 0.00011, limitPrice: 50_000, notionalEur: 5.5 }),
      NOW + 1_000,
    );
    expect(differentVolume.ok).toBe(false);

    // El registro original sigue intacto: no se contaminó ni se sustituyó.
    expect(Object.keys(state.orders)).toHaveLength(1);
    expect(state.orders[first.order.clOrdId]?.request.volumeBase).toBe(0.0001);

    // Y el reintento genuinamente idéntico sigue funcionando con normalidad.
    const sameRequestAgain = prepareOrder(state, config, buyRequest("reused-key", { volumeBase: 0.0001, notionalEur: 5 }), NOW + 2_000);
    expect(sameRequestAgain.ok).toBe(true);
    if (sameRequestAgain.ok) expect(sameRequestAgain.deduplicated).toBe(true);
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

  it("stays reconciliation_required after a timeout retry when there is still no evidence, instead of resending blindly", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("retry-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "timeout" });

    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");

    // El exchange simulado nunca llegó a registrar la orden (el escenario
    // "timeout" lanza antes de crearla): un único intento de localización sin
    // resultado no basta para reenviar ni para exigir revisión humana todavía.
    await retryReconciliation(state, transport, config, prepared.order.clOrdId, NOW + 60_000);
    const order = state.orders[prepared.order.clOrdId];
    expect(order?.status).toBe("reconciliation_required");
    expect(order?.exchangeOrderId).toBeNull();
    expect(state.activeClOrdId).toBe(prepared.order.clOrdId);
    expect(state.emergencyStopActive).toBe(false);
    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(0);
  });

  it("never blindly resends an order that the exchange actually received before the timeout", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("phantom-accept-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "accept-but-report-timeout" });

    const submitted = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(submitted.order.status).toBe("reconciliation_required");
    expect(submitted.order.exchangeOrderId).toBeNull();
    const attemptsAfterTimeout = submitted.order.attempts;

    await retryReconciliation(state, transport, config, prepared.order.clOrdId, NOW + 30_000);
    const order = state.orders[prepared.order.clOrdId];
    // Se localizó por cl_ord_id: nunca se llamó a createOrder una segunda vez.
    expect(order?.attempts).toBe(attemptsAfterTimeout);
    expect(order?.exchangeOrderId).not.toBeNull();
    expect(order?.status === "submitted" || order?.status === "filled" || order?.status === "partially_filled").toBe(true);
    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(1);
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
    expect(state.inventory.quantityBase).toBe(0);

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

  it("re-checks every guardrail right before sending, catching data that went stale between prepare and submit", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("stale-between-prepare-and-submit"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");

    // Los datos de mercado caducan antes de que llegue a enviarse.
    const staleNow = NOW + config.maxMarketDataAgeMs + 60_000;
    const result = await submitOrder(state, transport, config, prepared.order.clOrdId, staleNow);
    expect(result.ok).toBe(false);
    expect(result.order.status).toBe("cancelled");
    expect(state.activeClOrdId).toBeNull();
    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(0);
  });

  it("re-checks guardrails on submit without the order's own activeClOrdId self-blocking", async () => {
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("self-active-order"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    // Si el re-chequeo no excluyera la propia orden, esto fallaría siempre por
    // "ya existe una orden activa" y jamás llegaría a enviarse.
    const result = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(result.ok).toBe(true);
    expect(result.order.status).toBe("submitted");
  });
});

describe("live executor: never resubmits an order the exchange might already know about", () => {
  it("stays reconciliation_required and never calls createOrder again when the order is genuinely never found", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("truly-lost-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "timeout" });
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");

    // El exchange nunca la conoció: cada intento de localización sigue en null.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await retryReconciliation(state, transport, config, prepared.order.clOrdId, NOW + attempt * 60_000);
    }

    const order = state.orders[prepared.order.clOrdId];
    expect(order?.status).toBe("reconciliation_required");
    expect(order?.exchangeOrderId).toBeNull();
    // Nunca se resolvió reenviando: el exchange simulado sigue sin ninguna orden.
    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(0);
    // Agotados los intentos de localización, exige revisión humana.
    expect(state.emergencyStopActive).toBe(true);
    expect(state.emergencyStopReason).toMatch(/requiere revisión humana/);
  });
});

describe("live executor: base-asset precision (lot_decimals, not 6-decimal money rounding)", () => {
  it("preserves an 8-decimal BTC quantity exactly instead of rounding it like a EUR amount", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    // Menos de 6 decimales visibles perdería precisión con un redondeo a la
    // "money" (6dp); 8 decimales es justo el límite de lot_decimals de XBTEUR.
    const preciseVolume = 0.00012345;
    const prepared = prepareOrder(
      state,
      config,
      buyRequest("precision-signal", { volumeBase: preciseVolume, limitPrice: 1, notionalEur: preciseVolume }),
      NOW,
    );
    if (!prepared.ok) throw new Error(`expected prepare to succeed: ${JSON.stringify((prepared as { blockers?: string[] }).blockers)}`);
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);

    // Con un redondeo "money" de 6 decimales esto habría quedado en 0.000123,
    // perdiendo los dos últimos dígitos ("45"). Con cuantización a
    // lot_decimals (8) se conserva la cantidad completa.
    expect(state.inventory.quantityBase).toBeCloseTo(preciseVolume, 10);
    expect(state.inventory.quantityBase).not.toBeCloseTo(0.000123, 7);
  });
});

describe("live executor: partial fills, residual inventory and reconciliation", () => {
  it("moves a partially filled order to filled once reconciliation confirms the remote close", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("partial-signal", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.3 });

    const submitted = await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    expect(submitted.order.exchangeOrderId).not.toBeNull();

    await reconcile(state, transport, config, NOW + 30_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("partially_filled");
    // Inventario real ya refleja el 30% ejecutado, aunque la orden no esté "filled".
    expect(state.inventory.quantityBase).toBeCloseTo(0.3);
    expect(state.inventory.pair).toBe("XBTEUR");

    transport.completeFill(submitted.order.exchangeOrderId!);
    await reconcile(state, transport, config, NOW + 60_000);
    const finalOrder = state.orders[prepared.order.clOrdId];
    expect(finalOrder?.status).toBe("filled");
    expect(state.inventory.quantityBase).toBeCloseTo(1);
    expect(state.activeClOrdId).toBeNull();
  });

  it("leaves the executed portion as residual inventory when a partially filled sell is cancelled", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();

    // Primero se compra el inventario completo.
    const buy = prepareOrder(state, config, buyRequest("residual-buy", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.inventory.quantityBase).toBeCloseTo(1);

    // Luego se intenta vender todo, pero solo se ejecuta una parte antes de cancelar.
    const sell = prepareOrder(state, config, sellRequest("residual-sell", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW + 2_000);
    if (!sell.ok) throw new Error("expected sell prepare to succeed");
    expect(state.inventory.reservedQuantityBase).toBeCloseTo(1);
    transport.scriptScenario(sell.order.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.4 });
    const sellSubmitted = await submitOrder(state, transport, config, sell.order.clOrdId, NOW + 2_000);
    await reconcile(state, transport, config, NOW + 3_000);
    expect(state.orders[sell.order.clOrdId]?.status).toBe("partially_filled");
    expect(state.inventory.quantityBase).toBeCloseTo(0.6);

    await emergencyCancelAll(state, transport, config, "Cancelar venta parcial", NOW + 4_000);
    expect(state.orders[sell.order.clOrdId]?.status).toBe("cancelled");
    // El 40% vendido no reaparece: el inventario residual es 0.6, no 1 ni 0.
    expect(state.inventory.quantityBase).toBeCloseTo(0.6);
    expect(state.inventory.reservedQuantityBase).toBe(0);
    void sellSubmitted;
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
    await reconcile(state, emptyTransport, config, NOW + 30_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");
    expect(state.consecutiveTransportErrors).toBeGreaterThan(0);
  });

  it("escalates every open order to reconciliation_required when the observed balance contradicts local inventory", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("balance-mismatch", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.orders[buy.order.clOrdId]?.status).toBe("filled");
    expect(state.inventory.quantityBase).toBeCloseTo(1);

    transport.setBalance("XBT", "0");
    // Se prepara y envía una segunda orden solo para comprobar que la
    // reconciliación por balance también arrastra a órdenes no terminales.
    const sell = prepareOrder(state, config, sellRequest("balance-mismatch-sell", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW + 2_000);
    if (!sell.ok) throw new Error("expected sell prepare to succeed");
    transport.scriptScenario(sell.order.clOrdId, { kind: "accept-open" });
    await submitOrder(state, transport, config, sell.order.clOrdId, NOW + 2_000);

    await reconcile(state, transport, config, NOW + 3_000);
    expect(state.orders[sell.order.clOrdId]?.status).toBe("reconciliation_required");
    expect(state.emergencyStopActive).toBe(true);
  });

  it("blocks immediately on a balance mismatch even with no active order at all", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("balance-mismatch-no-order", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.activeClOrdId).toBeNull();

    transport.setBalance("XBT", "0");
    await reconcile(state, transport, config, NOW + 2_000);

    // Sin ninguna orden activa, la discrepancia igualmente bloquea de inmediato.
    expect(state.emergencyStopActive).toBe(true);
    const blocked = prepareOrder(state, config, sellRequest("balance-mismatch-recovery"), NOW + 3_000);
    expect(blocked.ok).toBe(false);
  });

  it("keeps every order blocked after clearing the alarm until a later reconcile confirms the balance is consistent again", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("balance-clear-then-block", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.activeClOrdId).toBeNull();

    // Discrepancia sin ninguna orden activa.
    transport.setBalance("XBT", "0");
    await reconcile(state, transport, config, NOW + 2_000);
    expect(state.emergencyStopActive).toBe(true);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);

    // Despejar la alarma NO basta: sigue bloqueando cualquier orden nueva.
    clearEmergencyStop(state, "Revisado, pero el balance sigue sin confirmarse", NOW + 3_000);
    expect(state.emergencyStopActive).toBe(false);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
    const stillBlockedOpen = prepareOrder(state, config, buyRequest("attempt-during-unresolved-open"), NOW + 4_000);
    expect(stillBlockedOpen.ok).toBe(false);
    if (!stillBlockedOpen.ok) expect(stillBlockedOpen.blockers).toContain("Liquidación manual pendiente tras una parada de emergencia");
    const stillBlockedClose = prepareOrder(state, config, sellRequest("attempt-during-unresolved-close"), NOW + 4_000);
    expect(stillBlockedClose.ok).toBe(false);

    // Solo una reconciliación posterior que confirme el balance real como
    // consistente permite, tras despejar de nuevo, volver a operar.
    transport.setBalance("XBT", "1");
    await reconcile(state, transport, config, NOW + 5_000);
    expect(state.lastBalanceCheckStatus).toBe("consistent");
    // El flag sigue en pie hasta que un humano lo despeje explícitamente de nuevo.
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);

    clearEmergencyStop(state, "Balance confirmado consistente", NOW + 6_000);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(false);
    const nowAllowed = prepareOrder(state, config, sellRequest("resolved-recovery"), NOW + 7_000);
    expect(nowAllowed.ok).toBe(true);
  });

  it("treats a failed balance fetch as unknown, not as a free pass, whenever there is inventory to verify", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("balance-fetch-fails", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.inventory.quantityBase).toBeCloseTo(1);

    const failingTransport: typeof transport = Object.assign(Object.create(Object.getPrototypeOf(transport)), transport, {
      fetchBalances: () => Promise.reject(new Error("network down")),
    });
    await reconcile(state, failingTransport, config, NOW + 2_000);
    expect(state.emergencyStopActive).toBe(true);
    expect(state.emergencyStopReason).toMatch(/No se pudo confirmar el balance real/);
  });

  it("treats an absent expected asset key as unknown rather than consistent", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("balance-key-missing", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);

    // El transporte real, por la razón que sea, responde sin ninguna clave de
    // XBT (a diferencia del seguimiento automático del mock): ausencia total
    // de evidencia con inventario ya asentado debe bloquear, no pasar.
    const noAssetKeyTransport: typeof transport = Object.assign(
      Object.create(Object.getPrototypeOf(transport)),
      transport,
      { fetchBalances: () => Promise.resolve({ ZEUR: "0" }) },
    );
    await reconcile(state, noAssetKeyTransport, config, NOW + 1_000);
    expect(state.emergencyStopActive).toBe(true);
  });
});

describe("reconcileInventoryAgainstBalances", () => {
  it("reports consistent only when there is genuinely nothing to verify (no inventory at all)", () => {
    expect(reconcileInventoryAgainstBalances({ pair: null, quantityBase: 0, averageCostEur: null, reservedQuantityBase: 0 }, {}))
      .toEqual({ status: "consistent", observedBalance: null });
  });

  it("reports unknown, never consistent, when there is inventory but no matching balance key", () => {
    expect(reconcileInventoryAgainstBalances({ pair: "XBTEUR", quantityBase: 1, averageCostEur: 50_000, reservedQuantityBase: 0 }, {}))
      .toEqual({ status: "unknown", observedBalance: null });
  });

  it("reports unknown, never consistent, when the balance fetch itself failed (null)", () => {
    expect(reconcileInventoryAgainstBalances({ pair: "XBTEUR", quantityBase: 1, averageCostEur: 50_000, reservedQuantityBase: 0 }, null))
      .toEqual({ status: "unknown", observedBalance: null });
  });

  it("matches Kraken's X-prefixed asset codes", () => {
    const inventory = { pair: "XBTEUR", quantityBase: 1, averageCostEur: 50_000, reservedQuantityBase: 0 };
    expect(reconcileInventoryAgainstBalances(inventory, { XXBT: "1.0000" }).status).toBe("consistent");
    expect(reconcileInventoryAgainstBalances(inventory, { XXBT: "0.5000" }).status).toBe("inconsistent");
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

    await emergencyCancelAll(state, transport, config, "Prueba de parada de emergencia", NOW + 5_000);

    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
    expect(state.emergencyStopActive).toBe(true);
    expect(state.activeClOrdId).toBeNull();
    // No se ejecutó nada: no hace falta liquidación manual.
    expect(state.emergencyStopRequiresManualLiquidation).toBe(false);

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

    await emergencyCancelAll(state, transport, config, "Cierre conservador sin envío previo", NOW + 1_000);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
  });

  it("flags manual liquidation as required when inventory remains after cancelling, and never auto-sells it", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("emergency-with-inventory", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.inventory.quantityBase).toBeCloseTo(1);

    await emergencyCancelAll(state, transport, config, "Emergencia con inventario abierto", NOW + 2_000);

    // La cancelación de emergencia nunca vende lo ya comprado.
    expect(state.inventory.quantityBase).toBeCloseTo(1);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);

    // Despejar la alarma NO borra la exigencia de liquidación manual mientras
    // siga existiendo el inventario: solo la resuelve evidencia real (cantidad
    // en 0), no la sola voluntad de despejar.
    clearEmergencyStop(state, "Revisado manualmente", NOW + 3_000);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
    expect(state.emergencyStopActive).toBe(false);

    // Y mientras siga pendiente, ninguna orden nueva puede prepararse.
    const blocked = prepareOrder(state, config, sellRequest("liquidation-attempt"), NOW + 4_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blockers).toContain("Liquidación manual pendiente tras una parada de emergencia");
  });

  it("clears manual liquidation once the inventory is genuinely resolved to zero", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const buy = prepareOrder(state, config, buyRequest("emergency-then-resolved", { volumeBase: 1, limitPrice: 1, notionalEur: 1 }), NOW);
    if (!buy.ok) throw new Error("expected buy prepare to succeed");
    await submitOrder(state, transport, config, buy.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);

    await emergencyCancelAll(state, transport, config, "Emergencia temporal", NOW + 2_000);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);

    // Un operador resuelve el inventario fuera de banda (o mediante un fill
    // real registrado por otra vía) hasta dejarlo en cero.
    state.inventory.quantityBase = 0;
    state.inventory.pair = null;

    clearEmergencyStop(state, "Inventario ya liquidado y verificado", NOW + 3_000);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(false);
  });
});

describe("live executor: recovery after restart", () => {
  it("preserves orders, idempotency mapping, inventory, and the audit trail across a serialize/deserialize cycle", async () => {
    const state = readyState();
    const config = enabledConfig();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config, buyRequest("restart-signal"), NOW);
    if (!prepared.ok) throw new Error("expected prepare to succeed");
    await submitOrder(state, transport, config, prepared.order.clOrdId, NOW);
    await reconcile(state, transport, config, NOW + 1_000);

    // Simula la persistencia y recuperación del Durable Object: serializar a JSON y
    // reconstruir el snapshot exactamente como haría `ctx.storage.get` tras reiniciar.
    const restarted = JSON.parse(JSON.stringify(state)) as LiveExecutorSnapshot;

    expect(restarted.orders[prepared.order.clOrdId]?.status).toBe("filled");
    expect(restarted.idempotencyIndex["restart-signal"]).toBe(prepared.order.clOrdId);
    expect(restarted.auditLog.length).toBe(state.auditLog.length);
    expect(restarted.inventory.quantityBase).toBeCloseTo(state.inventory.quantityBase);

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
    await reconcile(state, transport, config, NOW + 1_000);
    expect(state.inventory.quantityBase).toBeCloseTo(0.0001);
    expect(state.activeClOrdId).toBeNull();

    const sell = prepareOrder(state, config, sellRequest("close-sell"), NOW + 2_000);
    expect(sell.ok).toBe(true);
    if (!sell.ok) throw new Error("expected sell prepare to succeed");
    await submitOrder(state, transport, config, sell.order.clOrdId, NOW + 2_000);
    await reconcile(state, transport, config, NOW + 3_000);

    expect(state.inventory.quantityBase).toBe(0);
    expect(state.orders[sell.order.clOrdId]?.status).toBe("filled");
  });
});
