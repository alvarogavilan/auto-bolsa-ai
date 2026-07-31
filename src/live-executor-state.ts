import { DurableObject } from "cloudflare:workers";
import {
  clearEmergencyStop,
  emergencyCancelAll,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  reconcile,
  retryReconciliation,
  submitOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "./live-executor";
import { defaultLiveGuardrailConfig, liveTradingEnabledFromEnv } from "./live-guardrails";
import { FakeLiveOrderTransport, KrakenLiveOrderTransport, type LiveOrderTransport } from "./live-transport";
import type { Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const NONCE_KEY = "live-executor-kraken-nonce";

/**
 * Durable Object que persiste el estado del ejecutor LIVE.
 *
 * IMPORTANTE: esta clase no está enlazada a ninguna ruta HTTP ni al cron del
 * Worker. Nada en `index.ts` invoca `env.LIVE_EXECUTOR`. Existe únicamente para
 * validar que la persistencia, la idempotencia y la reconciliación sobreviven a
 * un reinicio (recreando el objeto desde `ctx.storage`), tal y como exige la
 * issue de construcción en paralelo. Conectarla a una ruta real es un paso
 * futuro y deliberadamente separado (ver docs/live-executor.md).
 */
export class LiveExecutorState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async read(): Promise<LiveExecutorSnapshot> {
    const stored = await this.ctx.storage.get<LiveExecutorSnapshot>(STORAGE_KEY);
    if (stored && stored.schemaVersion === "live-executor-snapshot-v1") return stored;
    return initializeLiveExecutor(Number(this.env.INITIAL_CASH_EUR || "50"));
  }

  private async write(state: LiveExecutorSnapshot): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private async nextNonce(): Promise<string> {
    const stored = await this.ctx.storage.get<string>(NONCE_KEY);
    const last = stored ? BigInt(stored) : 0n;
    const timeBased = BigInt(Date.now()) * 1000n;
    const next = timeBased > last ? timeBased : last + 1n;
    const value = next.toString();
    await this.ctx.storage.put(NONCE_KEY, value);
    return value;
  }

  /**
   * El transporte real solo se construye si `LIVE_TRADING_ENABLED === "true"` Y
   * hay credenciales configuradas. Con la variable ausente (estado por defecto en
   * producción) siempre se usa el mock, así que ninguna llamada llega a Kraken.
   */
  private transport(): LiveOrderTransport {
    const enabled = liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED);
    if (enabled && this.env.KRAKEN_API_KEY && this.env.KRAKEN_API_SECRET) {
      return new KrakenLiveOrderTransport(
        this.env.KRAKEN_API_KEY,
        this.env.KRAKEN_API_SECRET,
        () => this.nextNonce(),
      );
    }
    return new FakeLiveOrderTransport();
  }

  private guardrailConfig() {
    return defaultLiveGuardrailConfig({
      liveTradingEnabled: liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json(await this.read());
    }

    if (request.method === "POST" && url.pathname === "/observe-market") {
      const body = (await request.json()) as { equityEur: number };
      const state = await this.read();
      observeMarket(state, body.equityEur, now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/prepare") {
      const body = (await request.json()) as LiveOrderRequest;
      const state = await this.read();
      const result = prepareOrder(state, this.guardrailConfig(), body, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      const result = await submitOrder(state, this.transport(), this.guardrailConfig(), body.clOrdId, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/reconcile") {
      const state = await this.read();
      await reconcile(state, this.transport(), now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/retry") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      await retryReconciliation(state, this.transport(), this.guardrailConfig(), body.clOrdId, now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/emergency-cancel-all") {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const state = await this.read();
      await emergencyCancelAll(state, this.transport(), body.reason ?? "Cancelación de emergencia manual", now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/clear-emergency-stop") {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const state = await this.read();
      clearEmergencyStop(state, body.reason ?? "Despejado manualmente", now);
      await this.write(state);
      return Response.json(state);
    }

    return new Response("Not found", { status: 404 });
  }
}
