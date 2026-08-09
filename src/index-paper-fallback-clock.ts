import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-capital";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { buildNativeXauPaperInput } from "./xau-native-paper-feed";

export { BotState, ResearchLabState, LiveExecutorState };

function paperClockAllowed(env: Env): boolean {
  return env.TRADING_MODE === "paper" && env.LIVE_TRADING_ENABLED !== "true";
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

async function runDirectPaperDecision(env: Env): Promise<Record<string, unknown>> {
  const input = await buildNativeXauPaperInput();
  const response = await botState(env).fetch("https://bot/xau/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(`XAU cycle HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/xau/paper-clock") {
      if (!paperClockAllowed(env)) {
        return Response.json({
          ok: false,
          blocked: true,
          reason: "PAPER_ONLY_CLOCK",
          mode: env.TRADING_MODE,
          liveTrading: env.LIVE_TRADING_ENABLED === "true",
          realOrderSubmission: false,
        }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }

      try {
        const cycle = await runDirectPaperDecision(env);
        return Response.json({
          ok: true,
          source: "github-actions-paper-fallback",
          invokedAt: Date.now(),
          cycle,
          mode: "paper",
          liveTrading: false,
          realOrderSubmission: false,
        }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({
          ok: false,
          source: "github-actions-paper-fallback",
          error: error instanceof Error ? error.message : "UNKNOWN_XAU_PAPER_CLOCK_ERROR",
          mode: "paper",
          liveTrading: false,
          realOrderSubmission: false,
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
