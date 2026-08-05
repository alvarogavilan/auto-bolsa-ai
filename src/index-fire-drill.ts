import coreWorker, {
  BotState,
  ResearchLabState,
} from "./index";
import { GoldLiveExecutorState as LiveExecutorState } from "./live-executor-state-gold";
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

type DemoSource = { ok: boolean; status: number; data: unknown; error: string | null };

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

async function readDemoSource(path: string, env: Env): Promise<DemoSource> {
  try {
    const response = await coreWorker.fetch(new Request(`https://auto-bolsa.internal${path}`), env);
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
    return { ok: response.ok, status: response.status, data, error: response.ok ? null : `HTTP_${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : "UNKNOWN_SOURCE_ERROR" };
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function demoState(status: DemoSource, lab: DemoSource): string {
  const paper = record(status.data);
  const research = record(lab.data);
  if (!status.ok && !lab.ok) return "degraded";
  if (paper.paused === true) return "paused";
  if (paper.position) return "simulated-position";
  if (typeof paper.lastDecision === "string" && paper.lastDecision.includes("Límite")) return "safety-blocked";
  if (research.initialized === false || paper.lastTickAt == null) return "initializing";
  return "observing";
}

async function aggregatedDemo(env: Env): Promise<Response> {
  const [status, readiness, lab, markets, execution, decisions] = await Promise.all([
    readDemoSource("/api/status", env),
    readDemoSource("/api/readiness", env),
    readDemoSource("/api/lab", env),
    readDemoSource("/api/markets", env),
    readDemoSource("/api/execution", env),
    readDemoSource("/api/decisions", env),
  ]);
  const sources = { status, readiness, lab, markets, execution, decisions };
  const available = Object.values(sources).filter((source) => source.ok).length;
  return Response.json({
    schemaVersion: "auto-bolsa-demo-v1",
    generatedAt: Date.now(),
    mode: "paper",
    demoState: demoState(status, lab),
    available: available > 0,
    partial: available < Object.keys(sources).length,
    sourceSummary: { available, total: Object.keys(sources).length },
    paper: status.data,
    readiness: readiness.data,
    laboratory: lab.data,
    markets: markets.data,
    execution: execution.data,
    decisions: decisions.data,
    sourceHealth: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, {
      ok: source.ok,
      status: source.status,
      error: source.error,
    }])),
    liveTrading: false,
    realOrdersEnabled: false,
  }, { status: available > 0 ? 200 : 503, headers: { "Cache-Control": "no-store" } });
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

    if (request.method === "GET" && url.pathname === "/api/demo") return aggregatedDemo(env);
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