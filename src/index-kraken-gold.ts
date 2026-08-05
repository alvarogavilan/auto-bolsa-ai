import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-capital";
import { discoverKrakenGoldInstrument } from "./kraken-gold-instrument";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_TOKEN)
    && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.clone().json<unknown>();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function krakenGoldReadiness(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });

  const instrument = await discoverKrakenGoldInstrument();
  const authProbe = await worker.fetch(new Request(new URL("/api/kraken/connection", request.url), {
    headers: { Authorization: request.headers.get("Authorization") ?? "" },
  }), env, ctx);
  const kraken = await readJson(authProbe);
  const authenticated = authProbe.ok && kraken.configured === true;
  const balanceAvailable = authenticated
    && (typeof kraken.eurBalance === "number"
      || (kraken.balance && typeof kraken.balance === "object"));

  const blockers: string[] = [];
  if (!instrument) blockers.push("KRAKEN_GOLD_EUR_INSTRUMENT_NOT_FOUND");
  else {
    if (!instrument.tradable) blockers.push("KRAKEN_GOLD_INSTRUMENT_NOT_TRADABLE");
    if (!(instrument.orderMinBase > 0)) blockers.push("KRAKEN_GOLD_ORDER_MIN_INVALID");
    if (!(instrument.costMinQuote >= 0)) blockers.push("KRAKEN_GOLD_COST_MIN_INVALID");
  }
  if (!authenticated) blockers.push("KRAKEN_PRIVATE_AUTH_NOT_VERIFIED");
  if (!balanceAvailable) blockers.push("KRAKEN_BALANCE_NOT_VERIFIED");

  return Response.json({
    schemaVersion: "kraken-gold-live-readiness-v1",
    generatedAt: Date.now(),
    broker: "kraken",
    objective: "gold-only",
    instrument,
    privateApi: {
      httpStatus: authProbe.status,
      authenticated,
      balanceAvailable,
      configured: kraken.configured === true,
      permissionsSafe: kraken.permissionsSafe === true,
      withdrawalsEnabled: false,
    },
    readyForLivePreflight: blockers.length === 0,
    blockers,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    realOrderSubmitted: false,
  }, {
    status: authProbe.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/kraken/gold-readiness") {
      try {
        return await krakenGoldReadiness(request, env, ctx);
      } catch (error) {
        return Response.json({
          schemaVersion: "kraken-gold-live-readiness-v1",
          readyForLivePreflight: false,
          blockers: ["KRAKEN_GOLD_READINESS_PROBE_FAILED"],
          error: error instanceof Error ? error.message : "Unknown readiness error",
          liveTradingEnabled: false,
          realOrderSubmitted: false,
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
