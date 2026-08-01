import { DurableObject } from "cloudflare:workers";
import {
  clearEmergencyStop,
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "./live-executor";
import {
  calibratePristineValidationBaseline,
  prepareValidationOrder,
} from "./live-validation-order";
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
  checkLivePreflightCertificate,
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
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const STORAGE_KEY = "live-executor-snapshot";
const PAIR_METADATA_CACHE_KEY = "live-pair-resolution-cache-v2";
const PAIR_METADATA_TTL_MS = 60 * 60_000;
const JOURNAL_STORAGE_PREFIX = "live-submission-journal-v1:";

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
    const botState = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
    const response = await botState.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`No se pudo obtener el nonce compartido: HTTP ${response.status}`);
    const { nonce } = (await response.json()) as { nonce: string };
    return nonce;
  }

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

  private certificatePersistence(): LivePreflightCertificatePersistence {
    return {
      get: async (key) => (await this.ctx.storage.get<LivePreflightCertificate>(key)) ?? null,
      put: async (key, certificate) => {
        await this.ctx.storage.put(key, certificate);
      },
    };
  }

  private journalPersistence(): LiveSubmissionJournalPersistence {
    return {
      get: async (key) => (await this.ctx.storage.get<LiveSubmissionJournalEntry>(key)) ?? null,
      put: async (key, entry) => {
        await this.ctx.storage.put(key, entry);
      },
    };
  }

  private certificateStore(): AtomicLivePreflightCertificateStore {
    return new PersistedAtomicLivePreflightCertificateStore(
      this.certificatePersistence(),
      {
        run: <T>(operation: () => Promise<T>) => this.ctx.blockConcurrencyWhile(operation),
      },
    );
  }

  private submissionJournal(): PersistedLiveSubmissionJournal {
    return new PersistedLiveSubmissionJournal(
      this.journalPersistence(),
      {
        run: <T>(operation: () => Promise<T>) => this.ctx.blockConcurrencyWhile(operation),
      },
    );
  }

  private async hasPendingSubmissionJournal(): Promise<boolean> {
    const entries = await this.ctx.storage.list<LiveSubmissionJournalEntry>({ prefix: JOURNAL_STORAGE_PREFIX });
    return [...entries.values()].some((entry) => entry.phase !== "reconciled");
  }

  private async validationReadinessDetails(state: LiveExecutorSnapshot, now: number): Promise<Record<string, unknown>> {
    const order = state.activeClOrdId && state.orders[state.activeClOrdId]
      ? state.orders[state.activeClOrdId]!
      : Object.values(state.orders).sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    if (!order) {
      return {
        order: null,
        preflightCertificate: { status: "absent" },
        submissionJournal: { phase: "none" },
        reconciliation: {
          everRun: state.lastBalanceCheckStatus !== null,
          ok: state.lastBalanceCheckStatus === "consistent",
          balanceStatus: state.lastBalanceCheckStatus,
          unresolvedOrderCount: 0,
        },
      };
    }

    const certificate = await this.ctx.storage.get<LivePreflightCertificate>(
      livePreflightCertificateStorageKey(order.clOrdId),
    );
    let certificateStatus: "absent" | "valid" | "expired" | "consumed" | "invalid" = "absent";
    if (certificate) {
      if (certificate.consumedAt !== null) certificateStatus = "consumed";
      else if (now >= certificate.expiresAt) certificateStatus = "expired";
      else {
        const check = await checkLivePreflightCertificate(certificate, order.clOrdId, order.request, now);
        certificateStatus = check.allowed ? "valid" : "invalid";
      }
    }

    const journal = await this.ctx.storage.get<LiveSubmissionJournalEntry>(`${JOURNAL_STORAGE_PREFIX}${order.clOrdId}`);
    const unresolvedOrderCount = Object.values(state.orders).filter(
      (candidate) => candidate.status === "reconciliation_required",
    ).length;
    return {
      order: {
        clOrdId: order.clOrdId,
        status: order.status,
        pair: order.request.pair,
        side: order.request.side,
        volumeBase: order.request.volumeBase,
        limitPrice: order.request.limitPrice,
        notionalEur: order.request.notionalEur,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      preflightCertificate: {
        status: certificateStatus,
        issuedAt: certificate?.issuedAt ?? null,
        expiresAt: certificate?.expiresAt ?? null,
        consumedAt: certificate?.consumedAt ?? null,
        validateFlagForced: certificate?.proof.validateFlagForced ?? null,
        realOrderCreated: certificate?.proof.realOrderCreated ?? null,
      },
      submissionJournal: {
        phase: journal?.phase ?? "none",
        createdAt: journal?.createdAt ?? null,
        updatedAt: journal?.updatedAt ?? null,
        reconciledAt: journal?.reconciledAt ?? null,
      },
      reconciliation: {
        everRun: state.lastBalanceCheckStatus !== null,
        ok: state.lastBalanceCheckStatus === "consistent" && unresolvedOrderCount === 0,
        balanceStatus: state.lastBalanceCheckStatus,
        unresolvedOrderCount,
      },
    };
  }

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

    if (request.method === "GET" && url.pathname === "/readiness-details") {
      const state = await this.read();
      return Response.json(await this.validationReadinessDetails(state, now));
    }

    if (request.method === "POST" && url.pathname === "/observe-market") {
      const body = (await request.json()) as { equityEur: number };
      const state = await this.read();
      observeMarket(state, body.equityEur, now);
      await this.write(state);
      return Response.json(state);
    }

    if (request.method === "POST" && url.pathname === "/prepare-validation") {
      let body: { eurBalance: number; request: LiveOrderRequest };
      try {
        body = (await request.json()) as { eurBalance: number; request: LiveOrderRequest };
      } catch {
        return Response.json({ error: "Cuerpo interno de preparación validate-only inválido" }, { status: 400 });
      }
      const state = await this.read();
      const calibration = calibratePristineValidationBaseline(
        state,
        body.eurBalance,
        await this.hasPendingSubmissionJournal(),
        now,
      );
      if (!calibration.ok) {
        await this.write(calibration.state);
        return Response.json(calibration, { status: 409 });
      }
      const { config } = await this.reconciliationContext(now);
      const result = prepareValidationOrder(state, config, body.request, now);
      await this.write(result.state);
      return Response.json(result, { status: result.ok ? 200 : 409 });
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
