import { BotState as BaseBotState } from "./bot-state-base";
import {
  fetchKrakenEffectiveFees,
  type KrakenEffectiveFeesAudit,
} from "./kraken-fees";
import {
  KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH,
  KRAKEN_PRIVATE_LEASE_RELEASE_PATH,
  KRAKEN_PRIVATE_LEASE_TTL_MS,
} from "./kraken-private-lease";
import type { Env } from "./types";

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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH) {
      return this.privateLeaseAcquireResponse(request);
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
