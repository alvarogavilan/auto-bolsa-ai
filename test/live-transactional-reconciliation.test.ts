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
import { reconcileWithVerifiedFillsTransactional } from "../src/live-transactional-reconciliation";
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

function liveConfig() {
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

class StaticEvidenceSource implements LiveFillEvidenceSource {
  constructor(private readonly batch: LiveFillEvidenceBatch) {}
  async fetchForOrders(): Promise<LiveFillEvidenceBatch> {
    return this.batch;
  }
}

function fill(exchangeOrderId: string): LiveTradeExecution {
  return {
    tradeId: "TRADE-ATOMIC-1",
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
}

async function submittedOrder(): Promise<{
  state: LiveExecutorSnapshot;
  transport: FakeLiveOrderTransport;
  clOrdId: string;
  exchangeOrderId: string;
}> {
  const state = initializeLiveExecutor(50, NOW);
  observeMarket(state, 50, NOW);
  const transport = new FakeLiveOrderTransport();
  const prepared = prepareOrder(state, liveConfig(), request("atomic-reconciliation"), NOW);
  if (!prepared.ok) throw new Error("expected prepare to succeed");
  const submitted = await submitOrder(
    state,
    transport,
    liveConfig(),
    prepared.order.clOrdId,
    NOW + 1_000,
  );
  if (!submitted.ok || !submitted.order.exchangeOrderId) {
    throw new Error("expected submit to succeed");
  }
  return {
    state,
    transport,
    clOrdId: submitted.order.clOrdId,
    exchangeOrderId: submitted.order.exchangeOrderId,
  };
}

function source(exchangeOrderId: string): StaticEvidenceSource {
  return new StaticEvidenceSource({
    trades: [fill(exchangeOrderId)],
    coverageComplete: true,
    pagesFetched: 1,
    accountRowsScanned: 1,
    totalCount: 1,
  });
}

describe("transactional LIVE reconciliation", () => {
  it("commits inventory and terminal order state only when balance also agrees", async () => {
    const { state, transport, clOrdId, exchangeOrderId } = await submittedOrder();
    const report = await reconcileWithVerifiedFillsTransactional(
      state,
      transport,
      source(exchangeOrderId),
      liveConfig(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(true);
    expect(state.inventory.quantityBase).toBe(0.0001);
    expect(state.orders[clOrdId]?.filledVolumeBase).toBe(0.0001);
    expect(state.orders[clOrdId]?.status).toBe("filled");
    expect(state.auditLog.at(-1)?.event).toBe("transactional_reconciliation_committed");
  });

  it("rolls back inventory and fill state when the aggregate balance disagrees", async () => {
    const { state, transport, clOrdId, exchangeOrderId } = await submittedOrder();
    transport.setBalance("XXBT", "0.0002");

    const report = await reconcileWithVerifiedFillsTransactional(
      state,
      transport,
      source(exchangeOrderId),
      liveConfig(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(false);
    expect(report.balanceStatus).toBe("inconsistent");
    expect(state.inventory.quantityBase).toBe(0);
    expect(state.inventory.pair).toBeNull();
    expect(state.orders[clOrdId]?.filledVolumeBase).toBe(0);
    expect(state.orders[clOrdId]?.averageFillPrice).toBeNull();
    expect(state.orders[clOrdId]?.status).toBe("reconciliation_required");
    expect(state.emergencyStopActive).toBe(true);
    expect(state.auditLog.at(-1)?.event).toBe("transactional_reconciliation_rolled_back");
  });

  it("catches a regressive remote volume and preserves the complete prior snapshot", async () => {
    const { state, transport, clOrdId, exchangeOrderId } = await submittedOrder();
    const order = state.orders[clOrdId]!;
    order.filledVolumeBase = 0.0002;
    order.averageFillPrice = 49_000;
    state.inventory = {
      pair: "XBTEUR",
      quantityBase: 0.0002,
      averageCostEur: 49_000,
      reservedQuantityBase: 0,
    };

    const report = await reconcileWithVerifiedFillsTransactional(
      state,
      transport,
      source(exchangeOrderId),
      liveConfig(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(false);
    expect(report.message).toMatch(/retrocedió/);
    expect(state.inventory.quantityBase).toBe(0.0002);
    expect(state.inventory.averageCostEur).toBe(49_000);
    expect(state.orders[clOrdId]?.filledVolumeBase).toBe(0.0002);
    expect(state.orders[clOrdId]?.averageFillPrice).toBe(49_000);
    expect(state.orders[clOrdId]?.status).toBe("reconciliation_required");
    expect(state.emergencyStopActive).toBe(true);
  });
});
