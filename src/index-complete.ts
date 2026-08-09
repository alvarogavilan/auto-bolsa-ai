import worker, { BotState, ResearchLabState } from "./index-paper-capital";
import { LiveExecutorState } from "./live-executor-state-protected";
import { runXauPaxgLiveCycle } from "./xau-paxg-live-orchestrator";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/api/pilot/auto-cycle") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const result = await runXauPaxgLiveCycle(env);
      return Response.json(result, {
        status: result.action === "blocked" ? 409 : 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // La capa PAPER persiste primero la decisión XAU del minuto. Solo después
    // se evalúa el ejecutor PAXG. Mientras LIVE no cumpla sus tres interruptores,
    // runXauPaxgLiveCycle es una operación inerte sin llamadas privadas de orden.
    await worker.scheduled(controller, env, ctx);
    await runXauPaxgLiveCycle(env);
  },
};
