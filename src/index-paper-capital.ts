import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-fire-drill";
import type { Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function paperRuntimeEnv(env: Env): Env {
  if (env.INITIAL_CASH_EUR) return env;
  return { ...env, INITIAL_CASH_EUR: "100" };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return worker.fetch(request, paperRuntimeEnv(env), ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, paperRuntimeEnv(env), ctx);
  },
};
