import { LiveExecutorState as BaseLiveExecutorState } from "./live-executor-state";
import { liveTradingEnabledFromEnv } from "./live-guardrails";
import {
  reconcileKrakenGoldProtection,
  releaseKrakenGoldProtectionForExit,
} from "./kraken-gold-protection-lifecycle";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Extiende el ejecutor persistente sin alterar su máquina de estados. Tras una
 * reconciliación verificada, obliga a que el inventario PAXG y su stop remoto
 * queden coherentes. Si LIVE está apagado no hace ninguna llamada privada extra.
 */
export class LiveExecutorState extends BaseLiveExecutorState {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async nextSharedNonce(): Promise<string> {
    const bot = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
    const response = await bot.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`Nonce authority HTTP ${response.status}`);
    const body = object(await response.json());
    if (typeof body.nonce !== "string" || !body.nonce) throw new Error("Nonce authority returned no nonce");
    return body.nonce;
  }

  private protectionContext(state: Record<string, unknown>) {
    return {
      state: state as never,
      configuredPair: this.env.PAIR || "PAXGEUR",
      apiKey: this.env.KRAKEN_API_KEY!,
      apiSecret: this.env.KRAKEN_API_SECRET!,
      nextNonce: () => this.nextSharedNonce(),
      storage: this.ctx.storage,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const live = liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED);

    if (request.method === "POST" && url.pathname === "/protection/release-for-exit") {
      if (!live || !this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
        return Response.json({
          ok: false,
          released: false,
          blocker: "LIVE no está armado o faltan credenciales Kraken",
          liveTrading: false,
        }, { status: 409 });
      }
      const base = await super.fetch(new Request("https://live/status"));
      const state = object(await base.json());
      const result = await releaseKrakenGoldProtectionForExit(this.protectionContext(state));
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    const response = await super.fetch(request);
    if (!live || !this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) return response;
    if (request.method !== "POST" || (url.pathname !== "/reconcile" && url.pathname !== "/retry")) return response;

    const body = object(await response.clone().json().catch(() => ({})));
    const verified = object(body.verifiedReconciliation);
    const state = object(body.state);
    if (verified.ok !== true || Object.keys(state).length === 0) return response;

    try {
      const protection = await reconcileKrakenGoldProtection(this.protectionContext(state));
      if ("ok" in protection && protection.ok === false) {
        return Response.json({
          ...body,
          protection,
          failClosed: true,
          error: "GOLD_PROTECTION_NOT_VERIFIED",
        }, { status: 409 });
      }
      return Response.json({ ...body, protection }, { status: response.status });
    } catch (error) {
      return Response.json({
        ...body,
        failClosed: true,
        error: "GOLD_PROTECTION_RECONCILIATION_FAILED",
        message: error instanceof Error ? error.message : "Gold protection failed",
      }, { status: 409 });
    }
  }
}
