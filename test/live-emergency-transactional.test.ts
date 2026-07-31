import { describe, expect, it } from "vitest";
import {
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  submitOrder,
  type LiveOrderRequest,
} from "../src/live-executor";
import type { LiveTradeExecution } from "../src/live-fill-evidence";
import { defaultLiveGuardrailConfig } from "../src/live-guardrails";
import type { LivePairResolution } from "../src/live-pair-metadata";
import { emergencyCancelAllWithVerifiedFills } from "../src/live-verified-emergency";
import type {
  LiveFillEvidenceBatch,
  LiveFillEvidenceSource,
} from "../src/live-verified-reconciliation";
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

class StaticSource implements LiveFillEvidenceSource {
  constructor(private readonly batch: LiveFillEvidenceBatch) {}
  async fetchForOrders(): Promise<LiveFillEvidenceBatch> {
    return this.batch;
  }
}

function request(): LiveOrderRequest {
  return {
    idempotencyKey: "emergency-atomic-balance",
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
  };
}

function source(exchangeOrderId: string): LiveFillEvidenceSource {
  const trade: LiveTradeExecution = {
    tradeId: "TRADE-EMERGENCY-ATOMIC",
    exchangeOrderId,
    pair: "XXBTZEUR",
    side: "buy",
    timestampSeconds: NOW / 1000 + 1,
    price: 50_000,
    costQuote: 5,
    feeQuote: 0.04,
    volumeBase: 0.0001,
    maker: false,
  };
  return new StaticSource({
    trades: [trade],
    coverageComplete: true,
    pagesFetched: 1,
    accountRowsScanned: 1,
    totalCount: 1,
  });
}

describe("transactional emergency reconciliation", () => {
  it("does not accept residual inventory when fills agree but aggregate balance does not", async () => {
    const state = initializeLiveExecutor(50, NOW);
    observeMarket(state, 50, NOW);
    const transport = new FakeLiveOrderTransport();
    const prepared = prepareOrder(state, config(), request(), NOW);
    if (!prepared.ok) throw new Error("prepare failed");
    const submitted = await submitOrder(
      state,
      transport,
      config(),
      prepared.order.clOrdId,
      NOW + 1_000,
    );
    if (!submitted.ok || !submitted.order.exchangeOrderId) throw new Error("submit failed");

    // La orden y TradesHistory declaran 0.0001, pero el balance agregado no.
    transport.setBalance("XXBT", "0.0002");
    const report = await emergencyCancelAllWithVerifiedFills(
      state,
      transport,
      source(submitted.order.exchangeOrderId),
      config(),
      RESOLUTION,
      "Parada con balance incompatible",
      NOW + 2_000,
    );

    expect(report.reconciliation.ok).toBe(false);
    expect(report.reconciliation.balanceStatus).toBe("inconsistent");
    expect(state.inventory.quantityBase).toBe(0);
    expect(state.inventory.pair).toBeNull();
    expect(state.orders[prepared.order.clOrdId]?.filledVolumeBase).toBe(0);
    expect(state.orders[prepared.order.clOrdId]?.status).toBe("reconciliation_required");
    expect(report.requiresManualLiquidation).toBe(true);
    expect(state.emergencyStopActive).toBe(true);
    expect(state.emergencyStopRequiresManualLiquidation).toBe(true);
  });
});
