import worker, { BotState, ResearchLabState, LiveExecutorState } from "./index-paper-capital";
import { XauPaperState } from "./xau-usd-paper-state";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState, XauPaperState };

function xauState(env: Env): DurableObjectStub {
  return env.XAU_PAPER_STATE.get(env.XAU_PAPER_STATE.idFromName("auto-bolsa-ai-xau-paper"));
}

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

async function runConfiguredXauCycle(env: Env): Promise<void> {
  if (!env.XAU_PAPER_FEED_URL) return;
  const response = await fetch(env.XAU_PAPER_FEED_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`XAU feed HTTP ${response.status}`);
  const payload = await response.text();
  await xauState(env).fetch("https://xau/cycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/xau/status") return xauState(env).fetch("https://xau/status");
    if (request.method === "POST" && path === "/api/xau/cycle") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return xauState(env).fetch("https://xau/cycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() });
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await worker.scheduled(controller, env, ctx);
    ctx.waitUntil(runConfiguredXauCycle(env).catch(() => undefined));
  },
};
