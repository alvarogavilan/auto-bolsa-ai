import coreWorker, {
  BotState,
  ResearchLabState,
} from "./index";
import { CoordinatedLiveExecutorState as LiveExecutorState } from "./live-executor-state-coordinated";
import {
  auditPilotAccountCleanliness,
  enrichReadinessWithAccountCleanliness,
} from "./pilot-account-cleanliness";
import { manifestPilotDashboard } from "./pilot-dashboard-manifest";
import { runPilotFireDrill } from "./pilot-fire-drill";
import { enrichReadinessWithFireDrill } from "./pilot-fire-drill-readiness";
import { buildPilotOneShotManifest } from "./pilot-one-shot-manifest";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function internalAuthorizedRequest(request: Request, pathname: string, method = "GET"): Request {
  const headers = new Headers();
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  return new Request(`${new URL(request.url).origin}${pathname}`, { method, headers });
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

async function completeReadiness(
  request: Request,
  env: Env,
  forceAccountRefresh: boolean,
): Promise<Response> {
  const base = await coreWorker.fetch(
    internalAuthorizedRequest(request, "/api/pilot/readiness"),
    env,
  );
  const withFireDrill = await enrichReadinessWithFireDrill(base);
  return enrichReadinessWithAccountCleanliness(
    withFireDrill,
    env,
    forceAccountRefresh,
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/pilot") return manifestPilotDashboard();

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

    if (request.method === "POST" && url.pathname === "/api/pilot/one-shot-manifest") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const readinessResponse = await completeReadiness(request, env, true);
      if (!readinessResponse.ok) return readinessResponse;
      const feesResponse = await coreWorker.fetch(
        internalAuthorizedRequest(request, "/api/kraken/connection"),
        env,
      );
      const manifest = await buildPilotOneShotManifest(
        await responseObject(readinessResponse),
        await responseObject(feesResponse),
      );
      return Response.json(manifest, { headers: { "Cache-Control": "no-store" } });
    }

    if (
      (request.method === "GET" && url.pathname === "/api/pilot/readiness")
      || (request.method === "POST" && url.pathname === "/api/pilot/refresh-kraken")
    ) {
      // Composición de producción equivalente verificada:
      // enrichReadinessWithFireDrill(await coreWorker.fetch(request, env))
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
