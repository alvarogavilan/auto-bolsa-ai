import coreWorker, {
  BotState,
  LiveExecutorState,
  ResearchLabState,
} from "./index";
import { fireDrillPilotDashboard } from "./pilot-dashboard-fire-drill";
import { runPilotFireDrill } from "./pilot-fire-drill";
import { enrichReadinessWithFireDrill } from "./pilot-fire-drill-readiness";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/pilot") {
      return fireDrillPilotDashboard();
    }

    if (request.method === "POST" && url.pathname === "/api/pilot/fire-drill") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return Response.json(await runPilotFireDrill(), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (
      (request.method === "GET" && url.pathname === "/api/pilot/readiness")
      || (request.method === "POST" && url.pathname === "/api/pilot/refresh-kraken")
    ) {
      return enrichReadinessWithFireDrill(await coreWorker.fetch(request, env));
    }

    return coreWorker.fetch(request, env);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    return coreWorker.scheduled(controller, env, ctx);
  },
};
