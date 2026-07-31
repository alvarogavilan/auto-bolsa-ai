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
  reconcileWithVerifiedFills,
  type LiveFillEvidenceBatch,
  type LiveFillEvidenceSource,
} from "../src/live-verified-reconciliation";
import { FakeLiveOrderTransport } from "../src/live-transport";

const NOW = 1_800_000_000_000;

const RESOLUTION: LivePairResolution = {
  requestedPair: "XBTEUR",
  canonicalPair: "XXBTZEUR",
  acceptedPairCodes: ["XXBTZEUR", "XBTEUR", "XBT/EUR", "XBTEUR"],
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

class StaticEvidenceSource implements LiveFillEvidenceSource {
  constructor(private readonly batch: LiveFillEvidenceBatch) {}
  async fetchForOrders(): Promise<LiveFillEvidenceBatch> {
    return this.batch;
  }
}

async function submittedOrder(scenario: "filled" | "open" = "filled") {
  const state = readyState();
  const transport = new FakeLiveOrderTransport();
  const prepared = prepareOrder(state, config(), request(`verified-${scenario}`), NOW);
  if (!prepared.ok) throw new Error("expected prepare to succeed");
  if (scenario === "open") transport.scriptScenario(prepared.order.clOrdId, { kind: "accept-open" });
  const submitted = await submitOrder(state, transport, config(), prepared.order.clOrdId, NOW + 1_000);
  if (!submitted.ok || !submitted.order.exchangeOrderId) throw new Error("expected submit to succeed");
  return { state, transport, order: submitted.order };
}

function fill(orderId: string, overrides: Partial<LiveTradeExecution> = {}): LiveTradeExecution {
  return {
    tradeId: "TRADE-1",
    exchangeOrderId: orderId,
    pair: "XXBTZEUR",
    side: "buy",
    timestampSeconds: NOW / 1000 + 1,
    price: 50_000,
    costQuote: 5,
    feeQuote: 0.04,
    volumeBase: 0.0001,
    maker: false,
    ...overrides,
  };
}

describe("LIVE reconciliation gated by individual fills", () => {
  it("applies inventory only after order aggregate, fills and balance all agree", async () => {
    const { state, transport, order } = await submittedOrder();
    const report = await reconcileWithVerifiedFills(
      state,
      transport,
      new StaticEvidenceSource({
        trades: [fill(order.exchangeOrderId!)],
        coverageComplete: true,
        pagesFetched: 1,
        accountRowsScanned: 1,
        totalCount: 1,
      }),
      config(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(true);
    expect(report.balanceStatus).toBe("consistent");
    expect(state.orders[order.clOrdId]?.status).toBe("filled");
    expect(state.inventory.quantityBase).toBe(0.0001);
    expect(state.inventory.averageCostEur).toBe(50_000);
    expect(state.emergencyStopActive).toBe(false);
  });

  it("does not change inventory when the order reports a fill but TradesHistory has none", async () => {
    const { state, transport, order } = await submittedOrder();
    const report = await reconcileWithVerifiedFills(
      state,
      transport,
      new StaticEvidenceSource({
        trades: [],
        coverageComplete: true,
        pagesFetched: 1,
        accountRowsScanned: 0,
        totalCount: 0,
      }),
      config(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(false);
    expect(report.fillEvidenceByOrder[order.clOrdId]?.status).toBe("unknown");
    expect(state.inventory.quantityBase).toBe(0);
    expect(state.orders[order.clOrdId]?.status).toBe("reconciliation_required");
    expect(state.emergencyStopActive).toBe(true);
  });

  it("blocks before inventory mutation when volume, side or pair evidence disagrees", async () => {
    for (const badFill of [
      { volumeBase: 0.00009 },
      { side: "sell" as const },
      { pair: "ETHEUR" },
    ]) {
      const { state, transport, order } = await submittedOrder();
      const report = await reconcileWithVerifiedFills(
        state,
        transport,
        new StaticEvidenceSource({
          trades: [fill(order.exchangeOrderId!, badFill)],
          coverageComplete: true,
          pagesFetched: 1,
          accountRowsScanned: 1,
          totalCount: 1,
        }),
        config(),
        RESOLUTION,
        NOW + 2_000,
      );
      expect(report.ok).toBe(false);
      expect(state.inventory.quantityBase).toBe(0);
      expect(state.emergencyStopActive).toBe(true);
    }
  });

  it("treats an incomplete paginated history as unknown and fail-closed", async () => {
    const { state, transport, order } = await submittedOrder();
    const report = await reconcileWithVerifiedFills(
      state,
      transport,
      new StaticEvidenceSource({
        trades: [fill(order.exchangeOrderId!)],
        coverageComplete: false,
        pagesFetched: 20,
        accountRowsScanned: 1_000,
        totalCount: 1_500,
      }),
      config(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(false);
    expect(report.historyCoverageComplete).toBe(false);
    expect(state.inventory.quantityBase).toBe(0);
  });

  it("reconciles a genuinely open unfilled order with complete empty fill evidence", async () => {
    const { state, transport, order } = await submittedOrder("open");
    const report = await reconcileWithVerifiedFills(
      state,
      transport,
      new StaticEvidenceSource({
        trades: [],
        coverageComplete: true,
        pagesFetched: 1,
        accountRowsScanned: 0,
        totalCount: 0,
      }),
      config(),
      RESOLUTION,
      NOW + 2_000,
    );

    expect(report.ok).toBe(true);
    expect(state.orders[order.clOrdId]?.status).toBe("submitted");
    expect(state.inventory.quantityBase).toBe(0);
  });

  it("never applies fills twice across repeated successful reconciliation", async () => {
    const { state, transport, order } = await submittedOrder();
    const source = new StaticEvidenceSource({
      trades: [fill(order.exchangeOrderId!)],
      coverageComplete: true,
      pagesFetched: 1,
      accountRowsScanned: 1,
      totalCount: 1,
    });

    const first = await reconcileWithVerifiedFills(state, transport, source, config(), RESOLUTION, NOW + 2_000);
    const second = await reconcileWithVerifiedFills(state, transport, source, config(), RESOLUTION, NOW + 3_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(state.inventory.quantityBase).toBe(0.0001);
  });
});
