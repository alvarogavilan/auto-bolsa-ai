import worker, {
  BotState,
  ResearchLabState,
} from "./index-fire-drill";
import { LiveExecutorState } from "./live-executor-state-protected";
import { krakenGoldReadinessResponse } from "./index-kraken-gold";
import { derivePaperEconomicPerformance, type PaperEconomicStrategyLike } from "./paper-economic-performance";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { buildNativeXauFastPriceInput, buildNativeXauPaperInput } from "./xau-native-paper-feed";
import { runXauPaxgLiveCycle } from "./xau-paxg-live-orchestrator";
import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export { BotState, ResearchLabState, LiveExecutorState };

const XAU_FAST_INTERVAL_MS = 3_000;
const XAU_FAST_SAMPLES_PER_MINUTE = 19;
const XAU_BLOCKER_DIAGNOSTIC_WINDOW = 50;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function strategiesFromLabPayload(payload: unknown): PaperEconomicStrategyLike[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const candidates = [
    root.strategies,
    root.state && typeof root.state === "object" ? (root.state as Record<string, unknown>).strategies : null,
    root.lab && typeof root.lab === "object" ? (root.lab as Record<string, unknown>).strategies : null,
  ];
  const raw = candidates.find(Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const strategy = entry as Record<string, unknown>;
    if (typeof strategy.id !== "string" || typeof strategy.symbol !== "string" || !Array.isArray(strategy.trades)) return [];
    return [{ id: strategy.id, symbol: strategy.symbol, trades: strategy.trades as PaperEconomicStrategyLike["trades"] }];
  });
}

async function paperEconomicsResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const labUrl = new URL("/api/lab", request.url);
  const labResponse = await worker.fetch(new Request(labUrl, { headers: { Accept: "application/json" } }), env, ctx);
  if (!labResponse.ok) {
    return Response.json({
      schemaVersion: "paper-economic-performance-v1",
      mode: "paper",
      available: false,
      blocker: `Lab HTTP ${labResponse.status}`,
      liveTrading: false,
      realOrderSubmission: false,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const payload = await labResponse.json<unknown>();
  const performance = derivePaperEconomicPerformance(strategiesFromLabPayload(payload));
  return Response.json({
    schemaVersion: "paper-economic-performance-v1",
    mode: "paper",
    available: true,
    minimumMeaningfulNetProfitEur: 0.5,
    ...performance,
    liveTrading: false,
    realOrderSubmission: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function xauStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await botState(env).fetch("https://bot/xau/status");
  if (!response.ok) throw new Error(`XAU status HTTP ${response.status}`);
  return response.json<Record<string, unknown>>();
}

function isXauDecisionCycle(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== "object") return false;
  const instruction = (entry as Record<string, unknown>).instruction;
  if (!instruction || typeof instruction !== "object") return true;
  return (instruction as Record<string, unknown>).cycleKind !== "monitoring";
}

function latestXauDecisionCycle(status: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(status.cycles)) return null;
  return status.cycles.find(isXauDecisionCycle) ?? null;
}

function xauBlockerDiagnostics(status: Record<string, unknown>): {
  sampleSize: number;
  blockedDecisions: number;
  dominantBlocker: string | null;
  dominantBlockerCount: number;
  blockerFrequency: Array<{ blocker: string; count: number }>;
} {
  if (!Array.isArray(status.cycles)) {
    return { sampleSize: 0, blockedDecisions: 0, dominantBlocker: null, dominantBlockerCount: 0, blockerFrequency: [] };
  }
  const decisions = status.cycles.filter(isXauDecisionCycle).slice(0, XAU_BLOCKER_DIAGNOSTIC_WINDOW);
  const blocked = decisions.filter((cycle) => cycle.outcome === "blocked");
  const counts = new Map<string, number>();
  for (const cycle of blocked) {
    if (!Array.isArray(cycle.blockers)) continue;
    for (const blocker of cycle.blockers) {
      if (typeof blocker !== "string" || !blocker.trim()) continue;
      counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
    }
  }
  const blockerFrequency = [...counts.entries()]
    .map(([blocker, count]) => ({ blocker, count }))
    .sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
  return {
    sampleSize: decisions.length,
    blockedDecisions: blocked.length,
    dominantBlocker: blockerFrequency[0]?.blocker ?? null,
    dominantBlockerCount: blockerFrequency[0]?.count ?? 0,
    blockerFrequency,
  };
}

async function xauReadinessResponse(env: Env): Promise<Response> {
  const runtimeEnv = paperRuntimeEnv(env);
  const status = await xauStatus(runtimeEnv);
  const externalFeedConfigured = Boolean(runtimeEnv.XAU_PAPER_FEED_URL?.trim());
  const metrics = status.metrics && typeof status.metrics === "object" ? status.metrics as Record<string, unknown> : {};
  const cycles = typeof metrics.cycles === "number" ? metrics.cycles : 0;
  const decisionCycles = typeof metrics.decisionCycles === "number"
    ? metrics.decisionCycles
    : (typeof metrics.approved === "number" ? metrics.approved : 0) + (typeof metrics.blocked === "number" ? metrics.blocked : 0);
  const monitoringSamples = typeof metrics.monitoringSamples === "number" ? metrics.monitoringSamples : Math.max(0, cycles - decisionCycles);
  const approved = typeof metrics.approved === "number" ? metrics.approved : 0;
  const blocked = typeof metrics.blocked === "number" ? metrics.blocked : 0;
  const latestDecisionCycle = latestXauDecisionCycle(status);
  const latestDecisionOutcome = typeof latestDecisionCycle?.outcome === "string" ? latestDecisionCycle.outcome : null;
  const latestDecisionBlockers = Array.isArray(latestDecisionCycle?.blockers)
    ? latestDecisionCycle.blockers.filter((value): value is string => typeof value === "string")
    : [];
  const blockerDiagnostics = xauBlockerDiagnostics(status);

  return Response.json({
    schemaVersion: "xau-usd-paper-readiness-v6",
    market: "XAU/USD",
    mode: "paper",
    operational: true,
    marketObservationEnabled: true,
    entryProfile: externalFeedConfigured ? "full-technical-macro" : "strict-technical-paper-fallback",
    feedMode: externalFeedConfigured ? "external-plus-native-fast-price" : "native-kraken-xaut-proxy",
    externalFeedConfigured,
    automaticCycleEnabled: true,
    schedulerCron: "* * * * *",
    priceMonitoringIntervalSeconds: XAU_FAST_INTERVAL_MS / 1_000,
    fastSamplesPerMinute: XAU_FAST_SAMPLES_PER_MINUTE,
    decisionReanalysisSeconds: 60,
    baseStrategyCycleMinutes: 5,
    totalObservations: cycles,
    decisionCycles,
    monitoringSamples,
    approvedDecisionCycles: approved,
    blockedDecisionCycles: blocked,
    latestDecisionOutcome,
    latestDecisionBlockers,
    blockerDiagnostics,
    status,
    paperEntryCapable: true,
    paperEntryRequirements: externalFeedConfigured
      ? ["Consenso técnico y macro completo", "evidencia fresca", "asimetría y spread válidos"]
      : ["Unanimidad técnica 100 %", "spread <= 0,05 %", "asimetría >= 2,5R", "sin veto de riesgo"],
    blockers: latestDecisionOutcome === "blocked" ? latestDecisionBlockers : [],
    liveTrading: false,
    realOrderSubmission: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function xauDecisionInput(env: Env): Promise<XauPaperRuntimeInput> {
  if (env.XAU_PAPER_FEED_URL) {
    const response = await fetch(env.XAU_PAPER_FEED_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`XAU feed HTTP ${response.status}`);
    return response.json<XauPaperRuntimeInput>();
  }
  return buildNativeXauPaperInput();
}

async function submitXauCycle(env: Env, input: XauPaperRuntimeInput): Promise<void> {
  const response = await botState(env).fetch("https://bot/xau/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok && response.status !== 202) throw new Error(`XAU cycle HTTP ${response.status}`);
}

async function runXauDecisionCycle(env: Env): Promise<void> {
  await submitXauCycle(env, await xauDecisionInput(env));
}

async function runXauFastMonitoringSamples(env: Env): Promise<void> {
  for (let sample = 0; sample < XAU_FAST_SAMPLES_PER_MINUTE; sample += 1) {
    await sleep(XAU_FAST_INTERVAL_MS);
    try {
      await submitXauCycle(env, await buildNativeXauFastPriceInput());
    } catch {
      // Un fallo puntual de mercado nunca detiene las muestras posteriores ni el motor principal.
    }
  }
}

function shouldRunBaseStrategy(controller: ScheduledController): boolean {
  return new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const runtimeEnv = paperRuntimeEnv(env);
    if (request.method === "GET" && path === "/api/paper/economics") return paperEconomicsResponse(request, runtimeEnv, ctx);
    if (request.method === "GET" && path === "/api/xau/status") return botState(runtimeEnv).fetch("https://bot/xau/status");
    if (request.method === "GET" && path === "/api/xau/readiness") return xauReadinessResponse(runtimeEnv);
    if (request.method === "GET" && path === "/api/kraken/gold-readiness") {
      return krakenGoldReadinessResponse(request, runtimeEnv, ctx, worker);
    }
    if (request.method === "POST" && path === "/api/xau/cycle") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      return botState(runtimeEnv).fetch("https://bot/xau/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      });
    }
    if (request.method === "POST" && path === "/api/pilot/auto-cycle") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      const result = await runXauPaxgLiveCycle(runtimeEnv);
      return Response.json(result, {
        status: result.action === "blocked" ? 409 : 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return worker.fetch(request, runtimeEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const runtimeEnv = paperRuntimeEnv(env);
    if (shouldRunBaseStrategy(controller)) await worker.scheduled(controller, runtimeEnv, ctx);
    await runXauDecisionCycle(runtimeEnv);
    await runXauPaxgLiveCycle(runtimeEnv);
    ctx.waitUntil(runXauFastMonitoringSamples(runtimeEnv));
  },
};