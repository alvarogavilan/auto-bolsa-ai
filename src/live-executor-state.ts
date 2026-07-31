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
import { defaultLiveGuardrailConfig, liveTradingEnabledFromEnv, type LivePairMetadata } from "./live-guardrails";
import { fetchLivePairMetadata } from "./live-pair-metadata";
import { FakeLiveOrderTransport, KrakenLiveOrderTransport, type LiveOrderTransport } from "./live-transport";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const PAIR_METADATA_CACHE_KEY = "live-pair-metadata-cache-v1";
const PAIR_METADATA_TTL_MS = 60 * 60_000;

interface StoredPairMetadata {
  schemaVersion: "live-pair-metadata-cache-v1";
  pair: string;
  fetchedAt: number;
  expiresAt: number;
  metadata: Readonly<Record<string, LivePairMetadata>>;
}

/**
 * Durable Object que persistiría el estado del ejecutor LIVE.
 *
 * IMPORTANTE: esta clase NO está enlazada en `wrangler.jsonc` (no hay binding
 * ni migración) ni exportada desde `index.ts`, así que Cloudflare no la
 * instancia ni la despliega: no existe como recurso real en la cuenta. Solo
 * vive como código fuente, comprobado por `tsc --noEmit` y ejercitado
 * indirectamente a través de las funciones puras de `live-executor.ts` (la
 * recuperación tras reinicio se valida serializando/deserializando el
 * snapshot en los tests, igual que el resto del ejecutor). Enlazarla de
 * verdad —añadir el binding y la migración en `wrangler.jsonc`, exportarla
 * desde `index.ts`— es un paso futuro y deliberadamente separado (ver
 * docs/live-executor.md).
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

  /**
   * El ejecutor LIVE NUNCA mantiene su propio contador de nonce: pide el
   * siguiente a la única autoridad persistente (`BotState`), la misma que ya
   * sirve las llamadas privadas de PAPER para esta clave de API. Dos
   * contadores independientes podrían emitir nonces desordenados y disparar
   * el bloqueo temporal de Kraken (ver docs/kraken-api-safety.md).
   */
  private async nextNonce(): Promise<string> {
    const botState = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
    const response = await botState.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`No se pudo obtener el nonce compartido: HTTP ${response.status}`);
    const { nonce } = (await response.json()) as { nonce: string };
    return nonce;
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

  /**
   * Obtiene mínimos y precisiones desde AssetPairs y los conserva en Durable
   * Object storage. Para preparar/enviar una orden se exige información fresca.
   * Reconciliar o cancelar en emergencia puede usar la última copia conocida si
   * la API pública cae: una avería de datos nunca debe impedir una salida segura.
   */
  private async pairMetadata(
    pair: string,
    now: number,
    allowStale: boolean,
  ): Promise<Readonly<Record<string, LivePairMetadata>>> {
    const stored = await this.ctx.storage.get<StoredPairMetadata>(PAIR_METADATA_CACHE_KEY);
    const matchesPair = stored?.schemaVersion === "live-pair-metadata-cache-v1" && stored.pair === pair;

    if (matchesPair && stored.expiresAt > now) return stored.metadata;

    try {
      const metadata = await fetchLivePairMetadata(pair);
      const value: StoredPairMetadata = {
        schemaVersion: "live-pair-metadata-cache-v1",
        pair,
        fetchedAt: now,
        expiresAt: now + PAIR_METADATA_TTL_MS,
        metadata,
      };
      await this.ctx.storage.put(PAIR_METADATA_CACHE_KEY, value);
      return metadata;
    } catch (error) {
      if (allowStale && matchesPair) return stored.metadata;
      const message = error instanceof Error ? error.message : "No se pudieron obtener metadatos de Kraken";
      throw new Error(`LIVE bloqueado por metadatos de mercado no verificables: ${message}`);
    }
  }

  private async guardrailConfig(now: number, allowStale = false) {
    const pair = this.env.PAIR || "XBTEUR";
    const pairMetadata = await this.pairMetadata(pair, now, allowStale);
    return defaultLiveGuardrailConfig({
      liveTradingEnabled: liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED),
      pairMetadata,
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
      const result = prepareOrder(state, await this.guardrailConfig(now), body, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      const result = await submitOrder(
        state,
        this.transport(),
        await this.guardrailConfig(now),
        body.clOrdId,
        now,
      );
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/reconcile") {
      const state = await this.read();
      await reconcile(state, this.transport(), await this.guardrailConfig(now, true), now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/retry") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      await retryReconciliation(
        state,
        this.transport(),
        await this.guardrailConfig(now, true),
        body.clOrdId,
        now,
      );
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/emergency-cancel-all") {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const state = await this.read();
      await emergencyCancelAll(
        state,
        this.transport(),
        await this.guardrailConfig(now, true),
        body.reason ?? "Cancelación de emergencia manual",
        now,
      );
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
