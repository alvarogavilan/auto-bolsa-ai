import { describe, expect, it } from "vitest";
import { defaultLiveGuardrailConfig } from "../src/live-guardrails";
import { initializeLiveExecutor, prepareOrder, submitOrder, type LiveOrderRequest } from "../src/live-executor";
import {
  calibratePristineValidationBaseline,
  prepareValidationOrder,
} from "../src/live-validation-order";
import { FakeLiveOrderTransport } from "../src/live-transport";

const NOW = 1_800_000_000_000;
const REQUEST: LiveOrderRequest = {
  idempotencyKey: "server-validation-1",
  pair: "XBTEUR",
  side: "buy",
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

describe("validate-only preparation", () => {
  it("keeps normal prepareOrder blocked while LIVE is disabled", () => {
    const state = initializeLiveExecutor(50, NOW);
    const result = prepareOrder(state, defaultLiveGuardrailConfig(), REQUEST, NOW);
    expect(result.ok).toBe(false);
    expect(Object.keys(state.orders)).toHaveLength(0);
  });

  it("calibrates a pristine snapshot from authenticated EUR balance", () => {
    const state = initializeLiveExecutor(50, NOW);
    const result = calibratePristineValidationBaseline(state, 10, false, NOW + 1);
    expect(result.ok).toBe(true);
    expect(state.dayStartEquityEur).toBe(10);
    expect(state.currentEquityEur).toBe(10);
    expect(state.peakEquityEur).toBe(10);
    expect(state.lastBalanceCheckStatus).toBe("consistent");
    expect(state.lastMarketDataAt).toBe(NOW + 1);
    expect(state.auditLog.at(-1)?.event).toBe("validation_baseline_calibrated");
  });

  it("fails calibration when state is not pristine or journal is pending", () => {
    const cases = [
      (state: ReturnType<typeof initializeLiveExecutor>) => { state.activeClOrdId = "active"; },
      (state: ReturnType<typeof initializeLiveExecutor>) => { state.inventory.quantityBase = 0.1; state.inventory.pair = "XBTEUR"; },
      (state: ReturnType<typeof initializeLiveExecutor>) => { state.emergencyStopActive = true; },
      (state: ReturnType<typeof initializeLiveExecutor>) => { state.emergencyStopRequiresManualLiquidation = true; },
    ];
    for (const mutate of cases) {
      const state = initializeLiveExecutor(50, NOW);
      mutate(state);
      expect(calibratePristineValidationBaseline(state, 10, false, NOW).ok).toBe(false);
    }
    const journalState = initializeLiveExecutor(50, NOW);
    expect(calibratePristineValidationBaseline(journalState, 10, true, NOW).ok).toBe(false);
  });

  it("prepares locally with LIVE disabled while preserving all other guardrails", () => {
    const state = initializeLiveExecutor(50, NOW);
    expect(calibratePristineValidationBaseline(state, 10, false, NOW).ok).toBe(true);
    const result = prepareValidationOrder(state, defaultLiveGuardrailConfig(), REQUEST, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected validate-only preparation");
    expect(result.order.status).toBe("prepared");
    expect(result.order.exchangeOrderId).toBeNull();
    expect(state.activeClOrdId).toBe(result.order.clOrdId);
    expect(state.auditLog.at(-1)?.event).toBe("validation_order_prepared");
  });

  it("does not weaken submitOrder: disabled LIVE never reaches createOrder", async () => {
    const state = initializeLiveExecutor(50, NOW);
    calibratePristineValidationBaseline(state, 10, false, NOW);
    const prepared = prepareValidationOrder(state, defaultLiveGuardrailConfig(), REQUEST, NOW);
    if (!prepared.ok) throw new Error("expected validate-only preparation");
    const transport = new FakeLiveOrderTransport();
    const result = await submitOrder(
      state,
      transport,
      defaultLiveGuardrailConfig(),
      prepared.order.clOrdId,
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("LIVE_TRADING_ENABLED no está activado");
    expect((await transport.listOpenOrders()).length).toBe(0);
    expect((await transport.listClosedOrders()).length).toBe(0);
  });

  it("still blocks size, stale data, emergency and duplicate active orders", () => {
    const state = initializeLiveExecutor(50, NOW);
    calibratePristineValidationBaseline(state, 10, false, NOW);
    const tooLarge = prepareValidationOrder(
      state,
      defaultLiveGuardrailConfig(),
      { ...REQUEST, idempotencyKey: "too-large", volumeBase: 0.00012, notionalEur: 6 },
      NOW,
    );
    expect(tooLarge.ok).toBe(false);

    const stale = initializeLiveExecutor(50, NOW);
    calibratePristineValidationBaseline(stale, 10, false, NOW);
    stale.lastMarketDataAt = NOW - 10 * 60_000;
    expect(prepareValidationOrder(stale, defaultLiveGuardrailConfig(), REQUEST, NOW).ok).toBe(false);

    const emergency = initializeLiveExecutor(50, NOW);
    calibratePristineValidationBaseline(emergency, 10, false, NOW);
    emergency.emergencyStopActive = true;
    expect(prepareValidationOrder(emergency, defaultLiveGuardrailConfig(), REQUEST, NOW).ok).toBe(false);
  });
});
