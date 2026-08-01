import coreWorker, {
  BotState,
  ResearchLabState,
} from "./index";
import { CoordinatedLiveExecutorState as LiveExecutorState } from "./live-executor-state-coordinated";
import {
  auditPilotAccountCleanliness,
  enrichReadinessWithAccountCleanliness,
} from "./pilot-account-cleanliness";
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

    if (request.method === "GET" && url.pathname === "/pilot") return fireDrillPilotDashboard();

    if (request.method === "POST" && url.pathname === "/api/pilot/fire-drill") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return Response.json(await runPilotFireDrill(), { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST" && url.pathname === "/api/pilot/audit-account") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      try {
        return Response.json(await auditPilotAccountCleanliness(env, true), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        return Response.json({
          available: false,
          error: error instanceof Error ? error.message : "Kraken account audit failed",
          readOnly: true,
          realOrderCreated: false,
          liveTrading: false,
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (
      (request.method === "GET" && url.pathname === "/api/pilot/readiness")
      || (request.method === "POST" && url.pathname === "/api/pilot/refresh-kraken")
    ) {
      const base = await coreWorker.fetch(request, env);
      const withFireDrill = await enrichReadinessWithFireDrill(base);
      return enrichReadinessWithAccountCleanliness(withFireDrill, env, request.method === "POST");
    }

    return coreWorker.fetch(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return coreWorker.scheduled(controller, env, ctx);
  },
};
