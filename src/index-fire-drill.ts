import coreWorker, {
  BotState,
  LiveExecutorState,
  ResearchLabState,
} from "./index";
import { fireDrillPilotDashboard } from "./pilot-dashboard-fire-drill";
import { runPilotFireDrill } from "./pilot-fire-drill";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function enrichReadinessWithFireDrill(response: Response): Promise<Response> {
  if (!response.ok) return response;

  let body: Record<string, unknown>;
  try {
    const value = await response.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return response;
    body = value as Record<string, unknown>;
  } catch {
    return response;
  }

  const fireDrill = await runPilotFireDrill();
  const blockers = Array.isArray(body.blockers)
    ? body.blockers.filter((item): item is string => typeof item === "string")
    : [];
  const passedChecks = Array.isArray(body.passedChecks)
    ? body.passedChecks.filter((item): item is string => typeof item === "string")
    : [];

  if (fireDrill.passed) {
    passedChecks.push(`Simulacro integral superado: ${fireDrill.passedChecks}/${fireDrill.totalChecks}`);
  } else {
    blockers.push(`Simulacro integral incompleto: ${fireDrill.passedChecks}/${fireDrill.totalChecks}`);
  }

  const originalEligible = body.infrastructureEligibleForManualReview === true;
  const eligible = originalEligible && fireDrill.passed;
  return Response.json({
    ...body,
    fireDrill,
    blockers,
    passedChecks,
    infrastructureEligibleForManualReview: eligible,
    message: eligible
      ? "Infraestructura elegible para revisión humana. El envío real continúa sin ruta y sin activación."
      : `Piloto todavía bloqueado por ${blockers.length} condición(es).`,
    liveTrading: false,
  }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
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
