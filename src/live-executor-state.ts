import { DurableObject } from "cloudflare:workers";
import {
  calibrateLiveBaseline,
  clearEmergencyStop,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  prepareValidationOrder,
  type LiveExecutorSnapshot,
  type LiveOrder,
  type LiveOrderRequest,
} from "./live-executor";
import {
  submitOrderWithAtomicPreflightCertificate,
  type AtomicLivePreflightCertificateStore,
} from "./live-certified-submission";
import { defaultLiveGuardrailConfig, liveTradingEnabledFromEnv, type LiveGuardrailConfig } from "./live-guardrails";
import {
  KrakenValidateOnlyOrderGateway,
  runLiveOrderPreflight,
} from "./live-order-preflight";
import {
  createLivePreflightCertificate,
  type LivePreflightCertificate,
} from "./live-preflight-certificate";
import {
  PersistedAtomicLivePreflightCertificateStore,
  livePreflightCertificateStorageKey,
  type LivePreflightCertificatePersistence,
} from "./live-preflight-certificate-store";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import {
  PersistedLiveSubmissionJournal,
  liveSubmissionJournalStorageKey,
  type LiveSubmissionJournalEntry,
  type LiveSubmissionJournalPersistence,
} from "./live-submission-journal";
import { reconcileWithVerifiedFillsTransactional } from "./live-transactional-reconciliation";
import { FakeLiveOrderTransport, KrakenLiveOrderTransport, type LiveOrderTransport } from "./live-transport";
import {
  KrakenLiveFillEvidenceSource,
  UnavailableLiveFillEvidenceSource,
  type LiveFillEvidenceSource,
} from "./live-verified-reconciliation";
import { emergencyCancelAllWithVerifiedFills } from "./live-verified-emergency";
import { buildPilotValidationProposal, pilotValidationProposalToOrderRequest, preflightCertificateDisplayStatus } from "./pilot-validation";
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
 * indirectamente a través de las funciones puras del ejecutor.
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

  /** Persistencia local de certificados, separada del snapshot del ejecutor. */
  private certificatePersistence(): LivePreflightCertificatePersistence {
    return {
      get: async (key) => (await this.ctx.storage.get<LivePreflightCertificate>(key)) ?? null,
      put: async (key, certificate) => {
        await this.ctx.storage.put(key, certificate);
      },
    };
  }

  /** Persistencia local del journal write-ahead, separada del snapshot. */
  private journalPersistence(): LiveSubmissionJournalPersistence {
    return {
      get: async (key) => (await this.ctx.storage.get<LiveSubmissionJournalEntry>(key)) ?? null,
      put: async (key, entry) => {
        await this.ctx.storage.put(key, entry);
      },
    };
  }

  /**
   * El bloqueo de concurrencia cubre solo get/check/put local. Se libera antes
   * de cualquier llamada de red, evitando que dos envíos consuman el mismo
   * certificado sin mantener un lock durante Kraken.
   */
  private certificateStore(): AtomicLivePreflightCertificateStore {
    return new PersistedAtomicLivePreflightCertificateStore(
      this.certificatePersistence(),
      {
        run: <T>(operation: () => Promise<T>) => this.ctx.blockConcurrencyWhile(operation),
      },
    );
  }

  /** El journal usa la misma disciplina: sección crítica local, nunca red. */
  private submissionJournal(): PersistedLiveSubmissionJournal {
    return new PersistedLiveSubmissionJournal(
      this.journalPersistence(),
      {
        run: <T>(operation: () => Promise<T>) => this.ctx.blockConcurrencyWhile(operation),
      },
    );
  }

  /**
   * Tras una reconciliación completamente válida, resuelve únicamente los
   * journals de órdenes no preparadas y no incluidas entre las no resueltas.
   */
  private async resolveVerifiedJournals(
    state: LiveExecutorSnapshot,
    reportOk: boolean,
    unresolvedOrders: readonly string[],
    now: number,
  ): Promise<string[]> {
    if (!reportOk) return [];
    const unresolved = new Set(unresolvedOrders);
    const journal = this.submissionJournal();
    const resolved: string[] = [];

    for (const order of Object.values(state.orders)) {
      if (order.status === "prepared" || unresolved.has(order.clOrdId)) continue;
      const decision = await journal.recoveryDecision(order.clOrdId);
      if (decision.action !== "reconcile_only") continue;
      await journal.markReconciled(order.clOrdId, now);
      resolved.push(order.clOrdId);
    }
    return resolved;
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

  /** La orden activa si existe; si no, la más recientemente actualizada. */
  private latestRelevantOrder(state: LiveExecutorSnapshot): LiveOrder | null {
    if (state.activeClOrdId && state.orders[state.activeClOrdId]) return state.orders[state.activeClOrdId] ?? null;
    return Object.values(state.orders).sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  /**
   * Estado sanitizado del certificado y del journal para la orden relevante,
   * usado tanto por `/status` como por el informe de preparación. Ninguno de
   * los dos contiene secretos: son metadatos de la propia orden y del propio
   * proceso de envío, no credenciales.
   */
  private async certificateAndJournalStatus(
    state: LiveExecutorSnapshot,
    now: number,
  ): Promise<{ certificateStatus: string; journal: { phase: string } }> {
    const order = this.latestRelevantOrder(state);
    if (!order) return { certificateStatus: "absent", journal: { phase: "none" } };

    const certificate = await this.certificatePersistence().get(livePreflightCertificateStorageKey(order.clOrdId));
    const certificateStatus = await preflightCertificateDisplayStatus(certificate, order, now);

    const journalEntry = await this.journalPersistence().get(liveSubmissionJournalStorageKey(order.clOrdId));
    const journal = { phase: journalEntry?.phase ?? "none" };

    return { certificateStatus, journal };
  }

  /**
   * Metadatos públicos del par configurado (mínimo, decimales), o `null` si
   * no se pudieron obtener ni siquiera de una copia cacheada. Nunca lanza:
   * `/status` debe seguir respondiendo aunque la API pública de Kraken falle.
   */
  private async pairMetadataForDisplay(now: number): Promise<Record<string, unknown> | null> {
    const pair = this.env.PAIR || "XBTEUR";
    try {
      const resolution = await this.pairResolution(pair, now, true);
      return {
        pair: resolution.canonicalPair,
        orderMinBase: resolution.metadata.orderMinBase,
        lotDecimals: resolution.metadata.lotDecimals,
        priceDecimals: resolution.metadata.priceDecimals,
        checkedAt: now,
      };
    } catch {
      return null;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === "GET" && url.pathname === "/status") {
      const state = await this.read();
      const { certificateStatus, journal } = await this.certificateAndJournalStatus(state, now);
      const pairMetadata = await this.pairMetadataForDisplay(now);
      return Response.json({ ...state, certificateStatus, journal, pairMetadata });
    }

    if (request.method === "POST" && url.pathname === "/prepare-validation") {
      const proposalResult = await buildPilotValidationProposal(this.env);
      if (!proposalResult.ok) {
        return Response.json(
          {
            ok: false,
            error: "PILOT_VALIDATION_PROPOSAL_BLOCKED",
            blockers: proposalResult.blockers,
            liveTrading: false,
          },
          { status: 409 },
        );
      }
      const { proposal } = proposalResult;

      const state = await this.read();
      // La calibración solo se aplica si el estado sigue prístino; en
      // cualquier otro caso se omite en silencio (no es un bloqueo) y se
      // conserva la equidad ya existente, solo refrescando la frescura de
      // mercado con el precio público que se acaba de consultar.
      const calibration = calibrateLiveBaseline(state, { eurBalance: proposal.eurBalance }, now);
      if (!calibration.ok) {
        state.lastMarketDataAt = now;
        state.updatedAt = now;
      }

      const { config } = await this.reconciliationContext(now);
      const configForPair = {
        ...config,
        pairMetadata: { ...config.pairMetadata, [proposal.pair]: proposal.resolution.metadata },
      };
      const result = prepareValidationOrder(
        state,
        configForPair,
        pilotValidationProposalToOrderRequest(proposal),
        now,
      );
      await this.write(result.state);
      return Response.json(
        {
          ...result,
          baselineCalibrated: calibration.ok,
          proposal: {
            pair: proposal.pair,
            side: proposal.side,
            volumeBase: proposal.volumeBase,
            limitPrice: proposal.limitPrice,
            notionalEur: proposal.notionalEur,
            askPrice: proposal.askPrice,
            spreadPct: proposal.spreadPct,
            checkedAt: proposal.checkedAt,
          },
        },
        { status: result.ok ? 200 : 409 },
      );
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
            certificatePersisted: false,
            message: "Faltan credenciales Kraken.",
            liveTrading: false,
          },
          { status: 412 },
        );
      }

      let body: { clOrdId: string };
      try {
        body = (await request.json()) as { clOrdId: string };
      } catch {
        return Response.json(
          {
            status: "rejected",
            validateOnly: true,
            contactedKraken: false,
            realOrderCreated: false,
            certificatePersisted: false,
            message: "El cuerpo JSON del preflight no es válido.",
            liveTrading: false,
          },
          { status: 400 },
        );
      }

      if (!body.clOrdId?.trim()) {
        return Response.json({ error: "Falta clOrdId para el preflight", certificatePersisted: false }, { status: 400 });
      }

      const state = await this.read();
      const order = state.orders[body.clOrdId];
      if (!order) {
        return Response.json({ error: "Orden preparada desconocida", certificatePersisted: false }, { status: 404 });
      }
      if (order.status !== "prepared") {
        return Response.json(
          { error: `El preflight exige una orden prepared; estado actual: ${order.status}`, certificatePersisted: false },
          { status: 409 },
        );
      }

      const recovery = await this.submissionJournal().recoveryDecision(order.clOrdId);
      if (recovery.action === "reconcile_only") {
        return Response.json(
          {
            error: "Existe una intención de envío pendiente; se exige reconciliación y nunca un nuevo preflight",
            blockers: recovery.blockers,
            certificatePersisted: false,
          },
          { status: 409 },
        );
      }

      const pair = this.env.PAIR || "XBTEUR";
      if (order.request.pair !== pair) {
        return Response.json(
          { error: `La orden preparada no pertenece al par configurado ${pair}`, certificatePersisted: false },
          { status: 409 },
        );
      }

      const certificateKey = livePreflightCertificateStorageKey(order.clOrdId);
      // Un nuevo intento de preflight invalida cualquier certificado anterior,
      // incluso si Kraken devuelve rechazo, timeout o error de autenticación.
      await this.ctx.storage.delete(certificateKey);

      const resolution = await this.pairResolution(pair, now, false);
      const gateway = new KrakenValidateOnlyOrderGateway(
        this.env.KRAKEN_API_KEY,
        this.env.KRAKEN_API_SECRET,
        () => this.nextNonce(),
      );
      const intent = {
        pair: order.request.pair,
        side: order.request.side,
        volumeBase: order.request.volumeBase,
        limitPrice: order.request.limitPrice,
        notionalEur: order.request.notionalEur,
      };
      const result = await runLiveOrderPreflight(
        intent,
        {
          pairMetadata: { [pair]: resolution.metadata },
          maxNotionalEur: 5,
          maxNotionalDeviationPct: 0.01,
        },
        gateway,
        { now, clOrdIdFactory: () => order.clOrdId },
      );

      let certificate: LivePreflightCertificate | null = null;
      if (result.status === "validated") {
        try {
          certificate = await createLivePreflightCertificate(intent, result);
          await this.ctx.storage.put(certificateKey, certificate);
        } catch (error) {
          const message = error instanceof Error ? error.message : "No se pudo persistir el certificado";
          return Response.json(
            {
              ...result,
              status: "unknown",
              validateOnly: true,
              certificate: null,
              certificatePersisted: false,
              message: `Preflight no certificable: ${message}`,
              liveTrading: false,
            },
            { status: 502 },
          );
        }
      }

      const status = result.status === "validated" ? 200 : result.status === "rejected" ? 409 : 502;
      return Response.json(
        {
          ...result,
          validateOnly: true,
          certificate,
          certificatePersisted: certificate !== null,
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
      const result = await submitOrderWithAtomicPreflightCertificate(
        state,
        this.transport(),
        config,
        this.certificateStore(),
        body.clOrdId,
        now,
        this.submissionJournal(),
      );
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
      const reconciledJournals = await this.resolveVerifiedJournals(
        state,
        report.ok,
        report.unresolvedOrders,
        now,
      );
      await this.write(state);
      return Response.json(
        { state, verifiedReconciliation: report, reconciledJournals },
        { status: report.ok ? 200 : 409 },
      );
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
      const reconciledJournals = await this.resolveVerifiedJournals(
        state,
        report.ok,
        report.unresolvedOrders,
        now,
      );
      await this.write(state);
      return Response.json(
        { state, requestedClOrdId: body.clOrdId, verifiedReconciliation: report, reconciledJournals },
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
