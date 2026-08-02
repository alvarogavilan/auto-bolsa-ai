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
