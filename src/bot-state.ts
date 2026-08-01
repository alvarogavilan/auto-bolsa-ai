import { BotState as BaseBotState } from "./bot-state-base";
import { openOrders } from "./kraken";
import {
  fetchKrakenEffectiveFees,
  type KrakenEffectiveFeesAudit,
} from "./kraken-fees";
import type { Env } from "./types";

const KRAKEN_EFFECTIVE_FEES_KEY = "kraken-effective-fees-v1";
const KRAKEN_EFFECTIVE_FEES_TTL_MS = 10 * 60_000;

interface CachedFees {
  cachedAt: number;
  audit: KrakenEffectiveFeesAudit;
}

interface KrakenOpenOrdersAudit {
  checkedAt: number;
  openOrderCount: number;
  accountClean: boolean;
  permissionRequired: "query-open-trades";
  readOnly: true;
  realOrderCreated: false;
  liveTrading: false;
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

export class BotState extends BaseBotState {
  private readonly feeContext: DurableObjectState;
  private readonly feeEnv: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.feeContext = ctx;
    this.feeEnv = env;
  }

  private async nextCentralKrakenNonce(): Promise<string> {
    const nonceResponse = await super.fetch(new Request("https://bot/kraken/next-nonce", { method: "POST" }));
    if (!nonceResponse.ok) throw new Error(`Nonce authority HTTP ${nonceResponse.status}`);
    const nonceBody = await responseObject(nonceResponse);
    if (typeof nonceBody.nonce !== "string" || !nonceBody.nonce) {
      throw new Error("Nonce authority returned no nonce");
    }
    return nonceBody.nonce;
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
      // La auditoría es observabilidad fail-open; la conexión base conserva autoridad.
    }
    return null;
  }

  private async freshEffectiveFees(): Promise<KrakenEffectiveFeesAudit> {
    if (!this.feeEnv.KRAKEN_API_KEY || !this.feeEnv.KRAKEN_API_SECRET) {
      throw new Error("Kraken credentials are not configured");
    }
    const nonce = await this.nextCentralKrakenNonce();
    const audit = await fetchKrakenEffectiveFees(
      this.feeEnv.KRAKEN_API_KEY,
      this.feeEnv.KRAKEN_API_SECRET,
      nonce,
      this.feeEnv.PAIR || "XBTEUR",
      0.004,
    );
    try {
      await this.feeContext.storage.put(KRAKEN_EFFECTIVE_FEES_KEY, {
        cachedAt: Date.now(),
        audit,
      } satisfies CachedFees);
    } catch {
      // Una escritura de caché nunca convierte la conexión Kraken en fallo.
    }
    return audit;
  }

  private async freshOpenOrdersAudit(): Promise<KrakenOpenOrdersAudit> {
    if (!this.feeEnv.KRAKEN_API_KEY || !this.feeEnv.KRAKEN_API_SECRET) {
      throw new Error("Kraken credentials are not configured");
    }
    const nonce = await this.nextCentralKrakenNonce();
    const orders = await openOrders(
      this.feeEnv.KRAKEN_API_KEY,
      this.feeEnv.KRAKEN_API_SECRET,
      nonce,
    );
    return {
      checkedAt: Date.now(),
      openOrderCount: orders.length,
      accountClean: orders.length === 0,
      permissionRequired: "query-open-trades",
      readOnly: true,
      realOrderCreated: false,
      liveTrading: false,
    };
  }

  private async connectionWithFees(request: Request): Promise<Response> {
    const base = await super.fetch(request);
    if (!base.ok) return base;
    const body = await responseObject(base);
    if (body.connected !== true) return base;

    let openOrdersAudit: KrakenOpenOrdersAudit | null = null;
    let openOrdersError: string | null = null;
    try {
      openOrdersAudit = await this.freshOpenOrdersAudit();
    } catch (caught) {
      openOrdersError = caught instanceof Error ? caught.message : "Kraken open-order audit failed";
    }

    let audit = await this.cachedEffectiveFees();
    let error: string | null = null;
    if (!audit) {
      try {
        audit = await this.freshEffectiveFees();
      } catch (caught) {
        error = caught instanceof Error ? caught.message : "Kraken fee audit failed";
      }
    }

    const nonZeroAssetCount = Number(body.nonZeroAssetCount);
    const balancesClean = Number.isFinite(nonZeroAssetCount) && nonZeroAssetCount === 1;
    const accountClean = balancesClean && openOrdersAudit?.accountClean === true;

    return Response.json({
      ...body,
      openOrderCount: openOrdersAudit?.openOrderCount ?? null,
      accountClean,
      openOrdersAudit: {
        available: openOrdersAudit !== null,
        checkedAt: openOrdersAudit?.checkedAt ?? null,
        openOrderCount: openOrdersAudit?.openOrderCount ?? null,
        accountClean: openOrdersAudit?.accountClean ?? false,
        error: openOrdersError,
        permissionRequired: "query-open-trades",
        readOnly: true,
        realOrderCreated: false,
        liveTrading: false,
      },
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
    if (request.method === "GET" && url.pathname === "/kraken/connection") {
      return this.connectionWithFees(request);
    }
    return super.fetch(request);
  }
}
