import {
  addOrder,
  cancelOrder,
  closedOrders,
  fetchBalance,
  isKrakenOrderRejection,
  openOrders,
  queryOrders,
  type KrakenAddOrderRequest,
  type KrakenAddOrderResult,
} from "./kraken";

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

export interface LiveTransportCancelResult {
  cancelled: boolean;
}

export interface KrakenValidateOnlyOrderCall {
  request: KrakenAddOrderRequest;
  apiKey: string;
  apiSecret: string;
  nonce: string;
}

/**
 * Único adaptador autorizado para el preflight AddOrder. Fuerza `validate=true`
 * en el mismo módulo que ya concentra el resto de llamadas privadas LIVE y
 * recibe un nonce emitido por BotState; nunca crea ni calcula su propio nonce.
 */
export async function submitKrakenValidateOnlyOrder(
  call: KrakenValidateOnlyOrderCall,
): Promise<KrakenAddOrderResult> {
  return addOrder(
    { ...call.request, validate: true },
    call.apiKey,
    call.apiSecret,
    call.nonce,
  );
}

// Contrato que debe cumplir cualquier transporte de órdenes LIVE. El ejecutor solo
// conoce esta interfaz: nunca llama a Kraken directamente, así que sustituir el
// transporte real por el mock por defecto no requiere tocar la máquina de estados.
export interface LiveOrderTransport {
  createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck>;
  queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null>;
  /**
   * Busca una orden por `cl_ord_id` entre abiertas y cerradas. Debe usarse
   * antes de reenviar una orden que quedó sin `exchangeOrderId` tras un fallo
   * de transporte: si el exchange ya la conoce, reenviar sería ambiguo.
   */
  findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null>;
  cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult>;
  listOpenOrders(): Promise<LiveTransportOrderState[]>;
  listClosedOrders(): Promise<LiveTransportOrderState[]>;
  fetchBalances(): Promise<Record<string, string>>;
}

/**
 * Implementación real, usada únicamente si un futuro piloto manual la instancia y
 * conecta explícitamente. Ningún camino del Worker construye ni invoca esta clase
 * hoy: no hay ninguna ruta ni cron que la referencie.
 */
export class KrakenLiveOrderTransport implements LiveOrderTransport {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  async createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck> {
    const nonce = await this.nextNonce();
    try {
      const result = await addOrder(
        {
          pair: request.pair,
          type: request.side,
          ordertype: "limit",
          volume: request.volumeBase,
          price: request.limitPrice,
          clOrdId: request.clOrdId,
        },
        this.apiKey,
        this.apiSecret,
        nonce,
      );
      const exchangeOrderId = result.txid[0] ?? null;
      return {
        kind: exchangeOrderId ? "accepted" : "unknown",
        exchangeOrderId,
        raw: result,
      };
    } catch (error) {
      // Solo un rechazo explícito de Kraken (EOrder:*) es terminal. Cualquier
      // otro fallo (timeout, red, 5xx, EAPI/EGeneral, JSON malformado) se
      // propaga: el llamante (`submitOrder`) lo convierte en
      // `reconciliation_required`, nunca en un rechazo asumido.
      if (isKrakenOrderRejection(error)) {
        return { kind: "rejected", exchangeOrderId: null, raw: error.codes };
      }
      throw error;
    }
  }

  async queryOrder(exchangeOrderId: string): Promise<LiveTransportOrderState | null> {
    const nonce = await this.nextNonce();
    const [order] = await queryOrders([exchangeOrderId], this.apiKey, this.apiSecret, nonce);
    if (!order) return null;
    return toTransportState(order);
  }

  async findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null> {
    const [open, closed] = await Promise.all([this.listOpenOrders(), this.listClosedOrders()]);
    return [...open, ...closed].find((order) => order.clOrdId === clOrdId) ?? null;
  }

  async cancelOrder(exchangeOrderId: string): Promise<LiveTransportCancelResult> {
    const nonce = await this.nextNonce();
    const result = await cancelOrder(exchangeOrderId, this.apiKey, this.apiSecret, nonce);
    return { cancelled: result.count > 0 };
  }

  async listOpenOrders(): Promise<LiveTransportOrderState[]> {
    const nonce = await this.nextNonce();
    const orders = await openOrders(this.apiKey, this.apiSecret, nonce);
    return orders.map(toTransportState);
  }

  async listClosedOrders(): Promise<LiveTransportOrderState[]> {
    const nonce = await this.nextNonce();
    const orders = await closedOrders(this.apiKey, this.apiSecret, nonce);
    return orders.map(toTransportState);
  }

  async fetchBalances(): Promise<Record<string, string>> {
    const nonce = await this.nextNonce();
    return fetchBalance(this.apiKey, this.apiSecret, nonce);
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
    ? order.status
    : "unknown";
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

/**
 * Transporte mock/fake usado por defecto en pruebas y en cualquier composición que
 * no reciba explícitamente un transporte real. No realiza ninguna llamada de red.
 */
export class FakeLiveOrderTransport implements LiveOrderTransport {
  private readonly scenarioQueues = new Map<string, FakeTransportScenario[]>();
  private readonly orders = new Map<string, LiveTransportOrderState>();
  private readonly orderMeta = new Map<string, { pair: string; side: LiveOrderSide }>();
  private readonly balances = new Map<string, string>([["ZEUR", "0"]]);
  private sequence = 0;

  /** Fija el balance simulado de un activo (uso exclusivo de pruebas, sobrescribe el seguimiento automático). */
  setBalance(asset: string, amount: string): void {
    this.balances.set(asset, amount);
  }

  /**
   * Mantiene el balance simulado del activo base coherente con los fills
   * reales, igual que haría un exchange de verdad. Así, por defecto, el
   * inventario derivado y el "balance" del exchange nunca discrepan sin que
   * una prueba lo provoque explícitamente con `setBalance`.
   */
  private adjustBalance(pair: string, side: LiveOrderSide, deltaBase: number): void {
    if (deltaBase <= 0) return;
    if (!pair.endsWith("EUR")) return;
    const key = `X${pair.slice(0, -3)}`;
    const current = Number(this.balances.get(key) ?? "0");
    this.balances.set(key, String(side === "buy" ? current + deltaBase : current - deltaBase));
  }

  /**
   * Encola uno o varios escenarios para las próximas llamadas a `createOrder` con
   * ese `cl_ord_id`. Cada llamada consume el primero; agotada la cola, se acepta
   * por defecto (así un reintento tras un `timeout` puede tener éxito, igual que
   * en un reintento real contra una pasarela que sí llegó a procesar la orden).
   */
  scriptScenario(clOrdId: string, ...scenarios: FakeTransportScenario[]): void {
    this.scenarioQueues.set(clOrdId, [...scenarios]);
  }

  async createOrder(request: LiveTransportOrderRequest): Promise<LiveTransportAck> {
    // Idempotencia a nivel de transporte: reenviar el mismo cl_ord_id nunca crea una
    // segunda orden en el "exchange" simulado.
    const existing = [...this.orders.values()].find((order) => order.clOrdId === request.clOrdId);
    if (existing) {
      return { kind: "accepted", exchangeOrderId: existing.exchangeOrderId, raw: { duplicate: true } };
    }

    const queue = this.scenarioQueues.get(request.clOrdId) ?? [];
    const scenario = queue.shift() ?? { kind: "accept" };
    this.scenarioQueues.set(request.clOrdId, queue);
    if (scenario.kind === "timeout") {
      throw new Error("Timeout simulado de la pasarela de órdenes");
    }
    if (scenario.kind === "reject") {
      return { kind: "rejected", exchangeOrderId: null, raw: { reason: scenario.reason } };
    }
    if (scenario.kind === "unknown") {
      return { kind: "unknown", exchangeOrderId: null, raw: { malformed: true } };
    }

    this.sequence += 1;
    const exchangeOrderId = `FAKE-${this.sequence}`;
    const volumeBase = Number(request.volumeBase);
    const volumeExecutedBase = scenario.kind === "partial-then-fill"
      ? volumeBase * scenario.firstFillFraction
      : scenario.kind === "accept-open"
        ? 0
        : volumeBase;
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

    if (scenario.kind === "accept-but-report-timeout") {
      // El "exchange" simulado sí procesó la orden, pero el cliente nunca ve
      // la respuesta: modela un timeout de red después de que Kraken ya
      // aceptó la orden. `findByClOrdId` debe poder recuperarla.
      throw new Error("Timeout simulado tras aceptación remota real");
    }

    return { kind: "accepted", exchangeOrderId, raw: { clOrdId: request.clOrdId } };
  }

  async findByClOrdId(clOrdId: string): Promise<LiveTransportOrderState | null> {
    return [...this.orders.values()].find((order) => order.clOrdId === clOrdId) ?? null;
  }

  /** Avanza manualmente una orden simulada de parcial a completada (uso exclusivo de pruebas). */
  completeFill(exchangeOrderId: string): void {
    const order = this.orders.get(exchangeOrderId);
    if (!order) return;
    const remaining = order.volumeBase - order.volumeExecutedBase;
    this.orders.set(exchangeOrderId, {
      ...order,
      status: "closed",
      volumeExecutedBase: order.volumeBase,
    });
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

  async fetchBalances(): Promise<Record<string, string>> {
    return Object.fromEntries(this.balances);
  }
}
