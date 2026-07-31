import { DurableObject } from "cloudflare:workers";
import {
  clearEmergencyStop,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  submitOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "./live-executor";
import { defaultLiveGuardrailConfig, liveTradingEnabledFromEnv, type LiveGuardrailConfig } from "./live-guardrails";
import {
  KrakenValidateOnlyOrderGateway,
  runLiveOrderPreflight,
  type LiveOrderPreflightIntent,
} from "./live-order-preflight";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import { reconcileWithVerifiedFillsTransactional } from "./live-transactional-reconciliation";
import { FakeLiveOrderTransport, KrakenLiveOrderTransport, type LiveOrderTransport } from "./live-transport";
import {
  KrakenLiveFillEvidenceSource,
  UnavailableLiveFillEvidenceSource,
  type LiveFillEvidenceSource,
} from "./live-verified-reconciliation";
import { emergencyCancelAllWithVerifiedFills } from "./live-verified-emergency";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const PAIR_METADATA_CACHE_KEY = "live-pair-resolution-cache-v2";
const PAIR_METADATA_TTL_MS = 60 * 60_000;

interface StoredPairResolution {
  schemaVersion: "live-pair-resolution-cache-v2";
  pair: string;
  fetchedAt: number;
  expiresAt: number;
  resolution: LivePairResolution;
}

interface LiveReconciliationContext {
  resolution: LivePairResolution;
  config: LiveGuardrailConfig;
}

/**
 * Durable Object que persistiría el estado del ejecutor LIVE.
 *
 * IMPORTANTE: esta clase NO está enlazada en `wrangler.jsonc` (no hay binding
 * ni migración) ni exportada desde `index.ts`, así que Cloudflare no la
 * instancia ni la despliega: no existe como recurso real en la cuenta. Solo
 * vive como código fuente, comprobado por `tsc --noEmit` y ejercitado
 * indirectamente a través de las funciones puras del ejecutor. Enlazarla de
 * verdad es un paso futuro y deliberadamente separado.
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

  /** El nonce procede siempre de la única autoridad persistente BotState. */
  private async nextNonce(): Promise<string> {
    const botState = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
    const response = await botState.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`No se pudo obtener el nonce compartido: HTTP ${response.status}`);
    const { nonce } = (await response.json()) as { nonce: string };
    return nonce;
  }

  /**
   * El transporte real solo se construye si `LIVE_TRADING_ENABLED === "true"`
   * y hay credenciales. Hoy la variable está ausente y siempre se usa el mock.
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
   * La fuente real de fills solo puede construirse bajo activación explícita.
   * Cualquier otra composición falla cerrada.
   */
  private fillEvidenceSource(): LiveFillEvidenceSource {
    const enabled = liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED);
    if (enabled && this.env.KRAKEN_API_KEY && this.env.KRAKEN_API_SECRET) {
      return new KrakenLiveFillEvidenceSource(
        this.env.KRAKEN_API_KEY,
        this.env.KRAKEN_API_SECRET,
        () => this.nextNonce(),
      );
    }
    return new UnavailableLiveFillEvidenceSource();
  }

  /**
   * Obtiene mínimos, precisiones y aliases desde AssetPairs y los conserva en
   * storage. Preparar/enviar exige información fresca. Reconciliar o cancelar
   * en emergencia puede usar la última copia conocida si la API pública cae.
   */
  private async pairResolution(
    pair: string,
    now: number,
    allowStale: boolean,
  ): Promise<LivePairResolution> {
    const stored = await this.ctx.storage.get<StoredPairResolution>(PAIR_METADATA_CACHE_KEY);
    const matchesPair = stored?.schemaVersion === "live-pair-resolution-cache-v2" && stored.pair === pair;

    if (matchesPair && stored.expiresAt > now) return stored.resolution;

    try {
      const resolution = await fetchLivePairResolution(pair);
      const value: StoredPairResolution = {
        schemaVersion: "live-pair-resolution-cache-v2",
        pair,
        fetchedAt: now,
        expiresAt: now + PAIR_METADATA_TTL_MS,
        resolution,
      };
      await this.ctx.storage.put(PAIR_METADATA_CACHE_KEY, value);
      return resolution;
    } catch (error) {
      if (allowStale && matchesPair) return stored.resolution;
      const message = error instanceof Error ? error.message : "No se pudieron obtener metadatos de Kraken";
      throw new Error(`LIVE bloqueado por metadatos de mercado no verificables: ${message}`);
    }
  }

  private async reconciliationContext(now: number, allowStale = false): Promise<LiveReconciliationContext> {
    const pair = this.env.PAIR || "XBTEUR";
    const resolution = await this.pairResolution(pair, now, allowStale);
    return {
      resolution,
      config: defaultLiveGuardrailConfig({
        liveTradingEnabled: liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED),
        pairMetadata: { [pair]: resolution.metadata },
      }),
    };
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

    if (request.method === "POST" && url.pathname === "/preflight") {
      if (!this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
        return Response.json(
          {
            status: "rejected",
            configured: false,
            validateOnly: true,
            contactedKraken: false,
            realOrderCreated: false,
            message: "Faltan credenciales Kraken.",
            liveTrading: false,
          },
          { status: 412 },
        );
      }

      let body: LiveOrderPreflightIntent;
      try {
        body = (await request.json()) as LiveOrderPreflightIntent;
      } catch {
        return Response.json(
          {
            status: "rejected",
            validateOnly: true,
            contactedKraken: false,
            realOrderCreated: false,
            message: "El cuerpo JSON del preflight no es válido.",
            liveTrading: false,
          },
          { status: 400 },
        );
      }

      const pair = this.env.PAIR || "XBTEUR";
      if (body.side !== "buy" || body.pair !== pair) {
        return Response.json(
          {
            status: "rejected",
            validateOnly: true,
            contactedKraken: false,
            realOrderCreated: false,
            message: `El preflight interno solo admite compras límite para ${pair}.`,
            liveTrading: false,
          },
          { status: 409 },
        );
      }

      const resolution = await this.pairResolution(pair, now, false);
      const gateway = new KrakenValidateOnlyOrderGateway(
        this.env.KRAKEN_API_KEY,
        this.env.KRAKEN_API_SECRET,
        () => this.nextNonce(),
      );
      const result = await runLiveOrderPreflight(
        body,
        {
          pairMetadata: { [pair]: resolution.metadata },
          maxNotionalEur: 5,
          maxNotionalDeviationPct: 0.01,
        },
        gateway,
        { now },
      );
      const status = result.status === "validated" ? 200 : result.status === "rejected" ? 409 : 502;
      return Response.json(
        {
          ...result,
          validateOnly: true,
          liveTrading: false,
        },
        { status },
      );
    }

    if (request.method === "POST" && url.pathname === "/prepare") {
      const body = (await request.json()) as LiveOrderRequest;
      const state = await this.read();
      const { config } = await this.reconciliationContext(now);
      const result = prepareOrder(state, config, body, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      const { config } = await this.reconciliationContext(now);
      const result = await submitOrder(state, this.transport(), config, body.clOrdId, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/reconcile") {
      const state = await this.read();
      const { config, resolution } = await this.reconciliationContext(now, true);
      const report = await reconcileWithVerifiedFillsTransactional(
        state,
        this.transport(),
        this.fillEvidenceSource(),
        config,
        resolution,
        now,
      );
      await this.write(state);
      return Response.json({ state, verifiedReconciliation: report }, { status: report.ok ? 200 : 409 });
    }

    if (request.method === "POST" && url.pathname === "/retry") {
      const body = (await request.json()) as { clOrdId: string };
      const state = await this.read();
      if (!state.orders[body.clOrdId]) {
        return Response.json({ error: "Orden desconocida" }, { status: 404 });
      }
      const { config, resolution } = await this.reconciliationContext(now, true);
      const report = await reconcileWithVerifiedFillsTransactional(
        state,
        this.transport(),
        this.fillEvidenceSource(),
        config,
        resolution,
        now,
      );
      await this.write(state);
      return Response.json(
        { state, requestedClOrdId: body.clOrdId, verifiedReconciliation: report },
        { status: report.ok ? 200 : 409 },
      );
    }

    if (request.method === "POST" && url.pathname === "/emergency-cancel-all") {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const state = await this.read();
      const { config, resolution } = await this.reconciliationContext(now, true);
      const report = await emergencyCancelAllWithVerifiedFills(
        state,
        this.transport(),
        this.fillEvidenceSource(),
        config,
        resolution,
        body.reason ?? "Cancelación de emergencia manual",
        now,
      );
      await this.write(state);
      return Response.json({ state, verifiedEmergencyCancellation: report }, { status: 200 });
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
