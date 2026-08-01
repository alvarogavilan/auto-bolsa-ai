import worker, { BotState, LiveExecutorState, ResearchLabState } from "./index";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

type SourceResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error: string | null;
};

async function readSource(path: string, env: Env): Promise<SourceResult> {
  try {
    const response = await worker.fetch(new Request(`https://auto-bolsa.internal${path}`), env);
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `HTTP_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "UNKNOWN_SOURCE_ERROR",
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function deriveDemoState(status: SourceResult, lab: SourceResult): string {
  const paper = asRecord(status.data);
  const research = asRecord(lab.data);
  if (!status.ok && !lab.ok) return "degraded";
  if (paper.paused === true) return "paused";
  if (paper.position) return "simulated-position";
  if (paper.lastDecision && typeof paper.lastDecision === "string" && paper.lastDecision.includes("Límite")) {
    return "safety-blocked";
  }
  if (research.initialized === false || paper.lastTickAt == null) return "initializing";
  return "observing";
}

async function apiDemo(env: Env): Promise<Response> {
  const [status, readiness, lab, markets, execution, decisions] = await Promise.all([
    readSource("/api/status", env),
    readSource("/api/readiness", env),
    readSource("/api/lab", env),
    readSource("/api/markets", env),
    readSource("/api/execution", env),
    readSource("/api/decisions", env),
  ]);

  const sources = { status, readiness, lab, markets, execution, decisions };
  const availableSources = Object.values(sources).filter((source) => source.ok).length;
  const response = {
    schemaVersion: "auto-bolsa-demo-v1",
    generatedAt: Date.now(),
    mode: "paper",
    demoState: deriveDemoState(status, lab),
    available: availableSources > 0,
    partial: availableSources < Object.keys(sources).length,
    sourceSummary: {
      available: availableSources,
      total: Object.keys(sources).length,
    },
    paper: status.data,
    readiness: readiness.data,
    laboratory: lab.data,
    markets: markets.data,
    execution: execution.data,
    decisions: decisions.data,
    sourceHealth: Object.fromEntries(
      Object.entries(sources).map(([name, source]) => [name, {
        ok: source.ok,
        status: source.status,
        error: source.error,
      }]),
    ),
    liveTrading: false,
    realOrdersEnabled: false,
  };

  return Response.json(response, {
    status: availableSources > 0 ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/demo") return apiDemo(env);
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
