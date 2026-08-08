import { cancelOrder, closedOrders, fetchBalance, isKrakenOrderRejection, openOrders, queryOrders } from "./kraken";
import { addKrakenFokLimitOrder } from "./kraken-fok-order";

export type LiveOrderSide = "buy" | "sell";

export interface LiveTransportOrderRequest {
  clOrdId: string;
  pair: string;
  side: LiveOrderSide;
  volumeBase: string;
  limitPrice: string;
}

export type LiveTransportAckKind = "accepted" | "rejected" | "unknown";

export interface LiveTransportAck {
  kind: LiveTransportAckKind;
  exchangeOrderId: string | null;
  raw: unknown;
}

export interface LiveTransportOrderState {
  exchangeOrderId: string;
  clOrdId: string | null;
  status: "open" | "closed" | "canceled" | "unknown";
  volumeBase: number;
  volumeExecutedBase: number;
  averagePrice: number | null;
  reason: string | null;
}

export interface LiveTransportCancelResult { cancelled: boolean }

export interface LiveOrderTransport {
  createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck>;
  queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null>;
  findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null>;
  cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult>;
  listOpenOrders(): Promise<LiveTransportOrderState[]>;
  listClosedOrders(): Promise<LiveTransportOrderState[]>;
  fetchBalances(): Promise<Record<string, string>>;
}

export class KrakenLiveOrderTransport implements LiveOrderTransport {
  private privateCallTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  private async serializePrivateCall<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.privateCallTail;
    let release!: () => void;
    this.privateCallTail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await operation(); } finally { release(); }
  }

  private async openOrdersUnlocked(): Promise<LiveTransportOrderState[]> {
    const nonce = await this.nextNonce();
    return (await openOrders(this.apiKey, this.apiSecret, nonce)).map(toTransportState);
  }

  private async closedOrdersUnlocked(): Promise<LiveTransportOrderState[]> {
    const nonce = await this.nextNonce();
    return (await closedOrders(this.apiKey, this.apiSecret, nonce)).map(toTransportState);
  }

  async createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck> {
    return this.serializePrivateCall(async () => {
      const nonce = await this.nextNonce();
      try {
        const result = await addKrakenFokLimitOrder({
          pair: request.pair,
          type: request.side,
          volume: request.volumeBase,
          price: request.limitPrice,
          clOrdId: request.clOrdId,
        }, this.apiKey, this.apiSecret, nonce);
        const exchangeOrderId = result.txid[0] ?? null;
        return { kind: exchangeOrderId ? "accepted" : "unknown", exchangeOrderId, raw: result };
      } catch (error) {
        if (isKrakenOrderRejection(error)) {
          return { kind: "rejected", exchangeOrderId: null, raw: error.codes };
        }
        throw error;
      }
    });
  }

  async queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null> {
    return this.serializePrivateCall(async () => {
      const nonce = await this.nextNonce();
      const [order] = await queryOrders([exchangeOrderId], this.apiKey, this.apiSecret, nonce);
      return order ? toTransportState(order) : null;
    });
  }

  async findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null> {
    return this.serializePrivateCall(async () => {
      const open = await this.openOrdersUnlocked();
      const closed = await this.closedOrdersUnlocked();
      return [...open, ...closed].find((order) => order.clOrdId === clOrdId) ?? null;
    });
  }

  async cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult> {
    return this.serializePrivateCall(async () => {
      const nonce = await this.nextNonce();
      return { cancelled: (await cancelOrder(exchangeOrderId, this.apiKey, this.apiSecret, nonce)).count > 0 };
    });
  }

  async listOpenOrders(): Promise<LiveTransportOrderState[]> {
    return this.serializePrivateCall(() => this.openOrdersUnlocked());
  }

  async listClosedOrders(): Promise<LiveTransportOrderState[]> {
    return this.serializePrivateCall(() => this.closedOrdersUnlocked());
  }

  async fetchBalances(): Promise<Record<string, string>> {
    return this.serializePrivateCall(async () => {
      const nonce = await this.nextNonce();
      return fetchBalance(this.apiKey, this.apiSecret, nonce);
    });
  }
}

function toTransportState(order: {
  txid: string;
  clOrdId: string | null;
  status: string;
  volume: number;
  volumeExecuted: number;
  averagePrice: number | null;
  reason: string | null;
}): LiveTransportOrderState {
  const status = order.status === "open" || order.status === "closed" || order.status === "canceled"
    ? order.status : "unknown";
  return {
    exchangeOrderId: order.txid,
    clOrdId: order.clOrdId,
    status,
    volumeBase: order.volume,
    volumeExecutedBase: order.volumeExecuted,
    averagePrice: order.averagePrice,
    reason: order.reason,
  };
}

export type FakeTransportScenario =
  | { kind: "accept" }
  | { kind: "accept-open" }
  | { kind: "reject"; reason: string }
  | { kind: "timeout" }
  | { kind: "accept-but-report-timeout" }
  | { kind: "unknown" }
  | { kind: "partial-then-fill"; firstFillFraction: number };

export class FakeLiveOrderTransport implements LiveOrderTransport {
  private readonly scenarioQueues = new Map<string, FakeTransportScenario[]>();
  private readonly orders = new Map<string, LiveTransportOrderState>();
  private readonly orderMeta = new Map<string, { pair: string; side: LiveOrderSide }>();
  private readonly balances = new Map<string, string>([["ZEUR", "0"]]);
  private sequence = 0;

  setBalance(asset: string, amount: string): void { this.balances.set(asset, amount); }

  private adjustBalance(pair: string, side: LiveOrderSide, deltaBase: number): void {
    if (deltaBase <= 0 || !pair.endsWith("EUR")) return;
    const key = `X${pair.slice(0, -3)}`;
    const current = Number(this.balances.get(key) ?? "0");
    this.balances.set(key, String(side === "buy" ? current + deltaBase : current - deltaBase));
  }

  scriptScenario(clOrdId: string, ...scenarios: FakeTransportScenario[]): void {
    this.scenarioQueues.set(clOrdId, [...scenarios]);
  }

  async createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck> {
    const existing = [...this.orders.values()].find((order) => order.clOrdId === request.clOrdId);
    if (existing) return { kind: "accepted", exchangeOrderId: existing.exchangeOrderId, raw: { duplicate: true } };

    const queue = this.scenarioQueues.get(request.clOrdId) ?? [];
    const scenario = queue.shift() ?? { kind: "accept" };
    this.scenarioQueues.set(request.clOrdId, queue);
    if (scenario.kind === "timeout") throw new Error("Timeout simulado de la pasarela de órdenes");
    if (scenario.kind === "reject") return { kind: "rejected", exchangeOrderId: null, raw: { reason: scenario.reason } };
    if (scenario.kind === "unknown") return { kind: "unknown", exchangeOrderId: null, raw: { malformed: true } };

    this.sequence += 1;
    const exchangeOrderId = `FAKE-${this.sequence}`;
    const volumeBase = Number(request.volumeBase);
    const volumeExecutedBase = scenario.kind === "partial-then-fill"
      ? volumeBase * scenario.firstFillFraction
      : scenario.kind === "accept-open" ? 0 : volumeBase;
    this.orders.set(exchangeOrderId, {
      exchangeOrderId,
      clOrdId: request.clOrdId,
      status: volumeExecutedBase >= volumeBase ? "closed" : "open",
      volumeBase,
      volumeExecutedBase,
      averagePrice: Number(request.limitPrice),
      reason: null,
    });
    this.orderMeta.set(exchangeOrderId, { pair: request.pair, side: request.side });
    this.adjustBalance(request.pair, request.side, volumeExecutedBase);
    if (scenario.kind === "accept-but-report-timeout") throw new Error("Timeout simulado tras aceptación remota real");
    return { kind: "accepted", exchangeOrderId, raw: { clOrdId: request.clOrdId } };
  }

  async findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null> {
    return [...this.orders.values()].find((order) => order.clOrdId === clOrdId) ?? null;
  }

  completeFill(exchangeOrderId: string): void {
    const order = this.orders.get(exchangeOrderId);
    if (!order) return;
    const remaining = order.volumeBase - order.volumeExecutedBase;
    this.orders.set(exchangeOrderId, { ...order, status: "closed", volumeExecutedBase: order.volumeBase });
    const meta = this.orderMeta.get(exchangeOrderId);
    if (meta) this.adjustBalance(meta.pair, meta.side, remaining);
  }

  async queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null> {
    return this.orders.get(exchangeOrderId) ?? null;
  }

  async cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult> {
    const order = this.orders.get(exchangeOrderId);
    if (!order || order.status === "closed") return { cancelled: false };
    this.orders.set(exchangeOrderId, { ...order, status: "canceled" });
    return { cancelled: true };
  }

  async listOpenOrders(): Promise<LiveTransportOrderState[]> {
    return [...this.orders.values()].filter((order) => order.status === "open");
  }

  async listClosedOrders(): Promise<LiveTransportOrderState[]> {
    return [...this.orders.values()].filter((order) => order.status === "closed" || order.status === "canceled");
  }

  async fetchBalances(): Promise<Record<string, string>> { return Object.fromEntries(this.balances); }
}