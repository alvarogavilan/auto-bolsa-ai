import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-fallback-clock";
import { telegramTradeApprovalReadiness } from "./telegram-trade-approval";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/telegram/readiness") {
      const readiness = await telegramTradeApprovalReadiness(env);
      return Response.json({
        schemaVersion: "telegram-trade-approval-readiness-v1",
        ...readiness,
        secretValuesExposed: false,
        realOrderCreated: false,
      }, {
        status: readiness.botCanPost ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
