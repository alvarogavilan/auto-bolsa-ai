import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-capital";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function paperClockAllowed(env: Env): boolean {
  return env.TRADING_MODE === "paper" && env.LIVE_TRADING_ENABLED !== "true";
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

      const controller = {
        scheduledTime: Date.now(),
        cron: "github-actions-paper-fallback",
        noRetry() {},
      } as ScheduledController;

      await worker.scheduled(controller, env, ctx);
      return Response.json({
        ok: true,
        source: "github-actions-paper-fallback",
        invokedAt: Date.now(),
        mode: "paper",
        liveTrading: false,
        realOrderSubmission: false,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
