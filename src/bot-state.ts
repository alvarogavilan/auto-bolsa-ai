import { BotState as BaseBotState } from "./bot-state-base";
import {
  fetchKrakenEffectiveFees,
  type KrakenEffectiveFeesAudit,
} from "./kraken-fees";
import {
  KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH,
  KRAKEN_PRIVATE_LEASE_RELEASE_PATH,
  KRAKEN_PRIVATE_LEASE_RENEW_PATH,
  KRAKEN_PRIVATE_LEASE_TTL_MS,
} from "./kraken-private-lease";
import { createXauPaperCycleLedger, type XauPaperCycleLedger } from "./xau-usd-cycle-ledger";
import {
  parseXauPaperPositionBook,
  XAU_PAPER_POSITION_KEY,
  type XauPaperPositionBook,
} from "./xau-usd-paper-position";
import {
  runPersistentXauPaperCycle,
  XAU_PAPER_LEDGER_KEY,
  type XauPaperStateStore,
} from "./xau-usd-persistent-orchestrator";
import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";
import type { Env } from "./types";
import { RADAR_TRACK_KEY, parseRadarTrack, recordRadarSnapshot, type RadarSnapshot, type RadarTrackState } from "./radar-track-record";
import {
  SIGNAL_ALERT_STATE_KEY,
  claimSignalAlert,
  commitSignalAlert,
  parseSignalAlertState,
  releaseSignalAlert,
  type SignalAlertCommit,
  type SignalAlertState,
} from "./signal-alerts-store";

const KRAKEN_EFFECTIVE_FEES_KEY = "kraken-effective-fees-v1";
const KRAKEN_EFFECTIVE_FEES_TTL_MS = 10 * 60_000;
const KRAKEN_PRIVATE_LEASE_KEY = "kraken-private-lease-v1";

interface CachedFees {
  cachedAt: number;
  audit: KrakenEffectiveFeesAudit;
}

interface KrakenPrivateLease {
  schemaVersion: "kraken-private-lease-v1";
  leaseId: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function requestObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export class BotState extends BaseBotState {
  private readonly feeContext: DurableObjectState;
  private readonly feeEnv: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.feeContext = ctx;
    this.feeEnv = env;
  }

  private xauStore(): XauPaperStateStore {
    return {
      get: async (key) => (await this.feeContext.storage.get<string>(key)) ?? null,
      put: async (key, value) => { await this.feeContext.storage.put(key, value); },
    };
  }

  private async xauLedger(): Promise<XauPaperCycleLedger> {
    const raw = await this.feeContext.storage.get<string>(XAU_PAPER_LEDGER_KEY);
    if (!raw) return createXauPaperCycleLedger();
    try {
      return JSON.parse(raw) as XauPaperCycleLedger;
    } catch {
      return createXauPaperCycleLedger();
    }
  }

  private async xauPositionBook(): Promise<XauPaperPositionBook> {
    const raw = await this.feeContext.storage.get<string>(XAU_PAPER_POSITION_KEY);
    return parseXauPaperPositionBook(raw ?? null);
  }

  private async xauStatusResponse(): Promise<Response> {
    const [ledger, positionBook] = await Promise.all([
      this.xauLedger(),
      this.xauPositionBook(),
    ]);
    return Response.json(
      {
        ...ledger,
        positionBook,
        mode: "paper",
        liveTrading: false,
        realOrderSubmission: false,
        persistenceAuthority: "BotState",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  private async xauCycleResponse(request: Request): Promise<Response> {
    let input: XauPaperRuntimeInput;
    try {
      input = await request.json<XauPaperRuntimeInput>();
    } catch {
      return Response.json({ error: "Invalid XAU PAPER payload" }, { status: 400 });
    }
    const result = await runPersistentXauPaperCycle(this.xauStore(), input);
    return Response.json(result, {
      status: result.instruction.allowed ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  }

  private async acquirePrivateLease(owner: string, now = Date.now()): Promise<{
    acquired: boolean;
    lease: KrakenPrivateLease | null;
    retryAfterMs: number;
  }> {
    return this.feeContext.blockConcurrencyWhile(async () => {
      const active = await this.feeContext.storage.get<KrakenPrivateLease>(KRAKEN_PRIVATE_LEASE_KEY);
      if (active && active.expiresAt > now && active.owner !== owner) {
        return { acquired: false, lease: active, retryAfterMs: Math.max(25, active.expiresAt - now) };
      }

      const sameOwner = active?.owner === owner && active.expiresAt > now;
      const lease: KrakenPrivateLease = {
        schemaVersion: "kraken-private-lease-v1",
        leaseId: sameOwner ? active.leaseId : crypto.randomUUID(),
        owner,
        acquiredAt: sameOwner ? active.acquiredAt : now,
        expiresAt: now + KRAKEN_PRIVATE_LEASE_TTL_MS,
      };
      await this.feeContext.storage.put(KRAKEN_PRIVATE_LEASE_KEY, lease);
      return { acquired: true, lease, retryAfterMs: 0 };
    });
  }

  private async renewPrivateLease(leaseId: string, now = Date.now()): Promise<KrakenPrivateLease | null> {
    return this.feeContext.blockConcurrencyWhile(async () => {
      const active = await this.feeContext.storage.get<KrakenPrivateLease>(KRAKEN_PRIVATE_LEASE_KEY);
      if (!active || active.leaseId !== leaseId || active.expiresAt <= now) return null;
      const renewed: KrakenPrivateLease = {
        ...active,
        expiresAt: now + KRAKEN_PRIVATE_LEASE_TTL_MS,
      };
      await this.feeContext.storage.put(KRAKEN_PRIVATE_LEASE_KEY, renewed);
      return renewed;
    });
  }

  private async releasePrivateLease(leaseId: string): Promise<boolean> {
    return this.feeContext.blockConcurrencyWhile(async () => {
      const active = await this.feeContext.storage.get<KrakenPrivateLease>(KRAKEN_PRIVATE_LEASE_KEY);
      if (!active || active.leaseId !== leaseId) return false;
      await this.feeContext.storage.delete(KRAKEN_PRIVATE_LEASE_KEY);
      return true;
    });
  }

  private async privateLeaseAcquireResponse(request: Request): Promise<Response> {
    const body = await requestObject(request);
    const owner = typeof body.owner === "string" ? body.owner.trim() : "";
    if (!owner) return Response.json({ error: "Falta owner de la concesión" }, { status: 400 });
    const result = await this.acquirePrivateLease(owner);
    if (!result.acquired || !result.lease) {
      return Response.json(
        {
          acquired: false,
          retryAfterMs: Math.min(result.retryAfterMs, 250),
          message: "Otra operación privada Kraken conserva la concesión global.",
        },
        { status: 423, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { acquired: true, leaseId: result.lease.leaseId, expiresAt: result.lease.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  private async privateLeaseRenewResponse(request: Request): Promise<Response> {
    const body = await requestObject(request);
    const leaseId = typeof body.leaseId === "string" ? body.leaseId.trim() : "";
    if (!leaseId) return Response.json({ error: "Falta leaseId" }, { status: 400 });
    const renewed = await this.renewPrivateLease(leaseId);
    return Response.json(
      renewed
        ? { renewed: true, leaseId: renewed.leaseId, expiresAt: renewed.expiresAt }
        : { renewed: false, message: "La concesión no existe, cambió o ya caducó" },
      {
        status: renewed ? 200 : 409,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  private async privateLeaseReleaseResponse(request: Request): Promise<Response> {
    const body = await requestObject(request);
    const leaseId = typeof body.leaseId === "string" ? body.leaseId.trim() : "";
    if (!leaseId) return Response.json({ error: "Falta leaseId" }, { status: 400 });
    const released = await this.releasePrivateLease(leaseId);
    return Response.json({ released }, {
      status: released ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  private async withOwnPrivateLease(operation: () => Promise<Response>): Promise<Response> {
    const owner = `bot-state:${crypto.randomUUID()}`;
    const acquired = await this.acquirePrivateLease(owner);
    if (!acquired.acquired || !acquired.lease) {
      return Response.json(
        {
          error: "KRAKEN_PRIVATE_CALL_BUSY",
          retryAfterMs: Math.min(acquired.retryAfterMs, 250),
          message: "Otra operación privada Kraken está en curso; no se ha generado nonce ni enviado red.",
          liveTrading: false,
        },
        { status: 423, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      return await operation();
    } finally {
      await this.releasePrivateLease(acquired.lease.leaseId).catch(() => false);
    }
  }

  private async cachedEffectiveFees(now = Date.now()): Promise<KrakenEffectiveFeesAudit | null> {
    try {
      const cached = await this.feeContext.storage.get<CachedFees>(KRAKEN_EFFECTIVE_FEES_KEY);
      if (
        cached
        && typeof cached.cachedAt === "number"
        && now - cached.cachedAt <= KRAKEN_EFFECTIVE_FEES_TTL_MS
        && cached.audit?.schemaVersion === "kraken-effective-fees-v1"
      ) return cached.audit;
    } catch {
      // Observabilidad fail-open; la conexión base conserva autoridad.
    }
    return null;
  }

  private async freshEffectiveFees(): Promise<KrakenEffectiveFeesAudit> {
    if (!this.feeEnv.KRAKEN_API_KEY || !this.feeEnv.KRAKEN_API_SECRET) {
      throw new Error("Kraken credentials are not configured");
    }
    const nonceResponse = await super.fetch(new Request("https://bot/kraken/next-nonce", { method: "POST" }));
    if (!nonceResponse.ok) throw new Error(`Nonce authority HTTP ${nonceResponse.status}`);
    const nonceBody = await responseObject(nonceResponse);
    if (typeof nonceBody.nonce !== "string" || !nonceBody.nonce) throw new Error("Nonce authority returned no nonce");
    const audit = await fetchKrakenEffectiveFees(
      this.feeEnv.KRAKEN_API_KEY,
      this.feeEnv.KRAKEN_API_SECRET,
      nonceBody.nonce,
      this.feeEnv.PAIR || "XBTEUR",
      0.004,
    );
    try {
      await this.feeContext.storage.put(KRAKEN_EFFECTIVE_FEES_KEY, { cachedAt: Date.now(), audit } satisfies CachedFees);
    } catch {
      // Una escritura de caché nunca convierte la conexión Kraken en fallo.
    }
    return audit;
  }

  private async connectionWithFees(request: Request): Promise<Response> {
    const base = await super.fetch(request);
    if (!base.ok) return base;
    const body = await responseObject(base);
    if (body.connected !== true) return base;

    let audit = await this.cachedEffectiveFees();
    let error: string | null = null;
    if (!audit) {
      try {
        audit = await this.freshEffectiveFees();
      } catch (caught) {
        error = caught instanceof Error ? caught.message : "Kraken fee audit failed";
      }
    }

    return Response.json({
      ...body,
      effectiveFees: audit,
      effectiveFeesStatus: {
        available: audit !== null,
        error,
        cached: audit !== null && Date.now() - audit.checkedAt > 1_000,
        permissionRequired: "query-funds",
        readOnly: true,
        realOrderCreated: false,
        failOpenForConnection: true,
        liveTrading: false,
      },
      liveTrading: false,
    }, { status: base.status, headers: { "Cache-Control": "no-store" } });
  }

  private async signalAlertResponse(request: Request, path: string): Promise<Response> {
    const storage = this.feeContext.storage;
    if (request.method === "GET" && path === "/signal-alerts/state") {
      return Response.json(parseSignalAlertState(await storage.get<SignalAlertState>(SIGNAL_ALERT_STATE_KEY)), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    let body: Record<string, unknown>;
    try { body = await request.json<Record<string, unknown>>(); } catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    return this.feeContext.blockConcurrencyWhile(async () => {
      const state = parseSignalAlertState(await storage.get<SignalAlertState>(SIGNAL_ALERT_STATE_KEY));
      const key = typeof body.key === "string" ? body.key : "";
      if (path === "/signal-alerts/claim") {
        if (!key) return Response.json({ error: "KEY_REQUIRED" }, { status: 400 });
        const claimed = claimSignalAlert(state, key, Date.now());
        if (claimed) await storage.put(SIGNAL_ALERT_STATE_KEY, state);
        return Response.json({ claimed });
      }
      if (path === "/signal-alerts/release") {
        if (!key) return Response.json({ error: "KEY_REQUIRED" }, { status: 400 });
        releaseSignalAlert(state, key);
        await storage.put(SIGNAL_ALERT_STATE_KEY, state);
        return Response.json({ released: true });
      }
      if (path === "/signal-alerts/commit") {
        commitSignalAlert(state, body as unknown as SignalAlertCommit);
        await storage.put(SIGNAL_ALERT_STATE_KEY, state);
        return Response.json({ committed: true });
      }
      if (path === "/signal-alerts/reset-holding") {
        if (!key) return Response.json({ error: "KEY_REQUIRED" }, { status: 400 });
        delete state.holdings[key];
        await storage.put(SIGNAL_ALERT_STATE_KEY, state);
        return Response.json({ removed: true });
      }
      return new Response("Not found", { status: 404 });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/radar-track/state") {
      return Response.json(parseRadarTrack(await this.feeContext.storage.get<RadarTrackState>(RADAR_TRACK_KEY)));
    }
    if (request.method === "POST" && url.pathname === "/radar-track/record") {
      const snapshot = await request.json<RadarSnapshot>().catch(() => null);
      if (!snapshot || typeof snapshot.at !== "number" || !snapshot.topics) return Response.json({ error: "INVALID_SNAPSHOT" }, { status: 400 });
      return this.feeContext.blockConcurrencyWhile(async () => {
        const state = parseRadarTrack(await this.feeContext.storage.get<RadarTrackState>(RADAR_TRACK_KEY));
        const recorded = recordRadarSnapshot(state, snapshot);
        if (recorded) await this.feeContext.storage.put(RADAR_TRACK_KEY, state);
        return Response.json({ recorded, snapshots: state.snapshots.length });
      });
    }
    if (url.pathname.startsWith("/signal-alerts/")) {
      return this.signalAlertResponse(request, url.pathname);
    }
    if (request.method === "GET" && url.pathname === "/xau/status-lite") {
      // Vista ligera para la pantalla «Orden ahora» y las alertas: solo la
      // última decisión y el libro de posiciones (el ledger completo pesa ~0,5 MB).
      const [ledger, positionBook] = await Promise.all([this.xauLedger(), this.xauPositionBook()]);
      const latestDecision = ledger.cycles.find((cycle) => cycle.instruction?.cycleKind !== "monitoring");
      return Response.json({
        schemaVersion: ledger.schemaVersion,
        market: ledger.market,
        metrics: ledger.metrics,
        cycles: latestDecision ? [latestDecision] : [],
        positionBook: { ...positionBook, closed: positionBook.closed.slice(0, 10) },
        mode: "paper",
        liveTrading: false,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/xau/status") {
      return this.xauStatusResponse();
    }
    if (request.method === "POST" && url.pathname === "/xau/cycle") {
      return this.xauCycleResponse(request);
    }
    if (request.method === "POST" && url.pathname === KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH) {
      return this.privateLeaseAcquireResponse(request);
    }
    if (request.method === "POST" && url.pathname === KRAKEN_PRIVATE_LEASE_RENEW_PATH) {
      return this.privateLeaseRenewResponse(request);
    }
    if (request.method === "POST" && url.pathname === KRAKEN_PRIVATE_LEASE_RELEASE_PATH) {
      return this.privateLeaseReleaseResponse(request);
    }
    if (request.method === "GET" && url.pathname === "/kraken/connection") {
      return this.withOwnPrivateLease(() => this.connectionWithFees(request));
    }
    if (request.method === "GET" && url.pathname === "/kraken/permissions") {
      return this.withOwnPrivateLease(() => super.fetch(request));
    }
    return super.fetch(request);
  }
}
