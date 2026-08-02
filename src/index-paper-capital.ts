import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-fire-drill";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { buildNativeXauFastPriceInput, buildNativeXauPaperInput } from "./xau-native-paper-feed";
import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export { BotState, ResearchLabState, LiveExecutorState };

const XAU_FAST_INTERVAL_MS = 3_000;
const XAU_FAST_SAMPLES_PER_MINUTE = 19;

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

async function xauStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await botState(env).fetch("https://bot/xau/status");
  if (!response.ok) throw new Error(`XAU status HTTP ${response.status}`);
  return response.json<Record<string, unknown>>();
}

async function xauReadinessResponse(env: Env): Promise<Response> {
  const runtimeEnv = paperRuntimeEnv(env);
  const status = await xauStatus(runtimeEnv);
  const externalFeedConfigured = Boolean(runtimeEnv.XAU_PAPER_FEED_URL?.trim());
  const metrics = status.metrics && typeof status.metrics === "object"
    ? status.metrics as Record<string, unknown>
    : {};
  const cycles = typeof metrics.cycles === "number" ? metrics.cycles : 0;

  return Response.json({
    schemaVersion: "xau-usd-paper-readiness-v3",
    market: "XAU/USD",
    mode: "paper",
    operational: true,
    marketObservationEnabled: true,
    feedMode: externalFeedConfigured ? "external-plus-native-fast-price" : "native-kraken-xaut-proxy",
    externalFeedConfigured,
    automaticCycleEnabled: true,
    schedulerCron: "* * * * *",
    priceMonitoringIntervalSeconds: XAU_FAST_INTERVAL_MS / 1_000,
    fastSamplesPerMinute: XAU_FAST_SAMPLES_PER_MINUTE,
    decisionReanalysisSeconds: 60,
    baseStrategyCycleMinutes: 5,
    cyclesObserved: cycles,
    status,
    tradingReady: externalFeedConfigured,
    blockers: externalFeedConfigured
      ? []
      : ["El precio y la posición se vigilan cada 3 segundos con XAUT/USD de Kraken, pero las nuevas entradas mantienen veto PAPER hasta recibir DXY, rendimientos reales y calendario macro frescos."],
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

async function runXauFastMonitoringWindow(env: Env): Promise<void> {
  await submitXauCycle(env, await xauDecisionInput(env));
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
    if (request.method === "GET" && path === "/api/xau/status") {
      return botState(paperRuntimeEnv(env)).fetch("https://bot/xau/status");
    }
    if (request.method === "GET" && path === "/api/xau/readiness") {
      return xauReadinessResponse(env);
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
    const runtimeEnv = paperRuntimeEnv(env);
    if (shouldRunBaseStrategy(controller)) await worker.scheduled(controller, runtimeEnv, ctx);
    ctx.waitUntil(runXauFastMonitoringWindow(runtimeEnv).catch(() => undefined));
  },
};
