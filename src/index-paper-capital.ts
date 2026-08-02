import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-fire-drill";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function paperRuntimeEnv(env: Env): Env {
  if (env.INITIAL_CASH_EUR) return env;
  return { ...env, INITIAL_CASH_EUR: "100" };
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

async function xauStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await botState(env).fetch("https://bot/xau/status");
  if (!response.ok) throw new Error(`XAU status HTTP ${response.status}`);
  return response.json<Record<string, unknown>>();
}

async function xauReadinessResponse(env: Env): Promise<Response> {
  const runtimeEnv = paperRuntimeEnv(env);
  const status = await xauStatus(runtimeEnv);
  const feedConfigured = Boolean(runtimeEnv.XAU_PAPER_FEED_URL?.trim());
  const metrics = status.metrics && typeof status.metrics === "object"
    ? status.metrics as Record<string, unknown>
    : {};
  const cycles = typeof metrics.cycles === "number" ? metrics.cycles : 0;

  return Response.json({
    schemaVersion: "xau-usd-paper-readiness-v1",
    market: "XAU/USD",
    mode: "paper",
    operational: feedConfigured,
    feedConfigured,
    feedStatus: feedConfigured ? "configured" : "missing",
    automaticCycleEnabled: feedConfigured,
    cron: "*/5 * * * *",
    cyclesObserved: cycles,
    status,
    blockers: feedConfigured
      ? []
      : ["Falta configurar XAU_PAPER_FEED_URL; el cron no puede recibir evidencia real XAU/USD."],
    liveTrading: false,
    realOrderSubmission: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function runConfiguredXauCycle(env: Env): Promise<void> {
  if (!env.XAU_PAPER_FEED_URL) return;
  const response = await fetch(env.XAU_PAPER_FEED_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`XAU feed HTTP ${response.status}`);
  const payload = await response.text();
  await botState(env).fetch("https://bot/xau/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/xau/status") {
      return botState(paperRuntimeEnv(env)).fetch("https://bot/xau/status");
    }
    if (request.method === "GET" && path === "/api/xau/readiness") {
      return xauReadinessResponse(env);
    }
    if (request.method === "POST" && path === "/api/xau/cycle") {
      if (!authorized(request, paperRuntimeEnv(env))) return new Response("Unauthorized", { status: 401 });
      return botState(paperRuntimeEnv(env)).fetch("https://bot/xau/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      });
    }
    return worker.fetch(request, paperRuntimeEnv(env), ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await worker.scheduled(controller, paperRuntimeEnv(env), ctx);
    ctx.waitUntil(runConfiguredXauCycle(paperRuntimeEnv(env)).catch(() => undefined));
  },
};
