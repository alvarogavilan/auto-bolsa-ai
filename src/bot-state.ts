import { BotState as BaseBotState } from "./bot-state-base";
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
    const nonceResponse = await super.fetch(new Request("https://bot/kraken/next-nonce", { method: "POST" }));
    if (!nonceResponse.ok) throw new Error(`Nonce authority HTTP ${nonceResponse.status}`);
    const nonceBody = await responseObject(nonceResponse);
    if (typeof nonceBody.nonce !== "string" || !nonceBody.nonce) {
      throw new Error("Nonce authority returned no nonce");
    }
    const audit = await fetchKrakenEffectiveFees(
      this.feeEnv.KRAKEN_API_KEY,
      this.feeEnv.KRAKEN_API_SECRET,
      nonceBody.nonce,
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
    if (request.method === "GET" && url.pathname === "/kraken/connection") {
      return this.connectionWithFees(request);
    }
    return super.fetch(request);
  }
}
