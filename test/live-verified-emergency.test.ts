import { describe, expect, it } from "vitest";
import {
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  submitOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "../src/live-executor";
import type { LiveTradeExecution } from "../src/live-fill-evidence";
import { defaultLiveGuardrailConfig } from "../src/live-guardrails";
import type { LivePairResolution } from "../src/live-pair-metadata";
import {
  type LiveFillEvidenceBatch,
  type LiveFillEvidenceSource,
} from "../src/live-verified-reconciliation";
import { emergencyCancelAllWithVerifiedFills } from "../src/live-verified-emergency";
import { FakeLiveOrderTransport } from "../src/live-transport";

const NOW = 1_800_000_000_000;
const RESOLUTION: LivePairResolution = {
  requestedPair: "XBTEUR",
  canonicalPair: "XXBTZEUR",
  acceptedPairCodes: ["XXBTZEUR", "XBTEUR", "XBT/EUR"],
  metadata: { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 },
};

function config() {
  return defaultLiveGuardrailConfig({
    liveTradingEnabled: true,
    pairMetadata: { XBTEUR: RESOLUTION.metadata },
  });
}

function request(key: string): LiveOrderRequest {
  return {
    idempotencyKey: key,
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
  };
}

function readyState(): LiveExecutorSnapshot {
  const state = initializeLiveExecutor(50, NOW);
  observeMarket(state, 50, NOW);
  return state;
}

class StaticSource implements LiveFillEvidenceSource {
  constructor(private readonly batch: LiveFillEvidenceBatch) {}
  async fetchForOrders(): Promise<LiveFillEvidenceBatch> {
    return this.batch;
  }
}

function trade(orderId: string, volumeBase = 0.0001): LiveTradeExecution {
  return {
    tradeId: `TRADE-${volumeBase}`,
    exchangeOrderId: orderId,
    pair: "XXBTZEUR",
    side: "buy",
    timestampSeconds: NOW / 1000 + 1,
    price: 50_000,
    costQuote: volumeBase * 50_000,
    feeQuote: volumeBase * 50_000 * 0.008,
    volumeBase,
    maker: false,
  };
}

function sourceWith(...trades: LiveTradeExecution[]): LiveFillEvidenceSource {
  return new StaticSource({
    trades,
    coverageComplete: true,
    pagesFetched: 1,
    accountRowsScanned: trades.length,
    totalCount: trades.length,
  });
}

describe("verified emergency cancellation", () => {
  it("cancels a never-submitted prepared order locally without consulting fills", async () => {
    const state = readyState();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request("prepared-only"), NOW);
    if (!prepared.ok) throw new Error("prepare failed");

    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      sourceWith(),
      config(),
      RESOLUTION,
      "Prueba de parada",
      NOW + 1_000,
    );

    expect(report.reconciliation.ok).toBe(true);
    expect(report.requiresManualLiquidation).toBe(false);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
    expect(state.emergencyStopActive).toBe(true);
    expect(state.inventory.quantityBase).toBe(0);
  });

  it("records only a fill-verified residual after cancelling a partially filled order", async () => {
    const state = readyState();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request("partial-emergency"), NOW);
    if (!prepared.ok) throw new Error("prepare failed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.4 });
    const submitted = await submitOrder(state, transport, config(), prepared.order.clOrdId, NOW + 1_000);
    if (!submitted.ok || !submitted.order.exchangeOrderId) throw new Error("submit failed");
    const partialVolume = 0.00004;

    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      sourceWith(trade(submitted.order.exchangeOrderId, partialVolume)),
      config(),
      RESOLUTION,
      "Parada con fill parcial",
      NOW + 2_000,
    );

    expect(report.reconciliation.ok).toBe(true);
    expect(report.requiresManualLiquidation).toBe(true);
    expect(state.inventory.quantityBase).toBe(partialVolume);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("cancelled");
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
  });

  it("does not mistake a failed cancellation for an unfilled order", async () => {
    const state = readyState();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request("already-filled"), NOW);
    if (!prepared.ok) throw new Error("prepare failed");
    const submitted = await submitOrder(state, transport, config(), prepared.order.clOrdId, NOW + 1_000);
    if (!submitted.ok || !submitted.order.exchangeOrderId) throw new Error("submit failed");

    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      sourceWith(trade(submitted.order.exchangeOrderId)),
      config(),
      RESOLUTION,
      "Orden ya ejecutada",
      NOW + 2_000,
    );

    expect(report.attempts[0]?.result).toBe("already_terminal_or_filled");
    expect(state.inventory.quantityBase).toBe(0.0001);
    expect(report.requiresManualLiquidation).toBe(true);
  });

  it("finds an ambiguous timeout by cl_ord_id and still requires its individual fill", async () => {
    const state = readyState();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request("timeout-emergency"), NOW);
    if (!prepared.ok) throw new Error("prepare failed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "accept-but-report-timeout" });
    const submitted = await submitOrder(state, transport, config(), prepared.order.clOrdId, NOW + 1_000);
    expect(submitted.ok).toBe(false);
    expect(submitted.order.exchangeOrderId).toBeNull();
    const remote = await transport.findByClOrdId(prepared.order.clOrdId);
    if (!remote) throw new Error("remote order missing");

    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      sourceWith(trade(remote.exchangeOrderId)),
      config(),
      RESOLUTION,
      "Timeout ambiguo",
      NOW + 2_000,
    );

    expect(report.attempts[0]?.result).toBe("ambiguous_without_exchange_id");
    expect(report.reconciliation.ok).toBe(true);
    expect(state.inventory.quantityBase).toBe(0.0001);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
  });

  it("keeps inventory unchanged and blocks when residual fill evidence is missing", async () => {
    const state = readyState();
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request("missing-emergency-fill"), NOW);
    if (!prepared.ok) throw new Error("prepare failed");
    transport.scriptScenario(prepared.order.clOrdId, { kind: "partial-then-fill", firstFillFraction: 0.4 });
    const submitted = await submitOrder(state, transport, config(), prepared.order.clOrdId, NOW + 1_000);
    if (!submitted.ok) throw new Error("submit failed");

    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      sourceWith(),
      config(),
      RESOLUTION,
      "Sin evidencia residual",
      NOW + 2_000,
    );

    expect(report.reconciliation.ok).toBe(false);
    expect(state.inventory.quantityBase).toBe(0);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
  });
});
