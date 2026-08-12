import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-fallback-clock";
import { liveArmingConfigurationStatus } from "./live-activation-readiness";
import { telegramTradeApprovalReadiness } from "./telegram-trade-approval";
import { LIVE_EXECUTOR_SINGLETON_NAME, type Env } from "./types";

export { BotState, ResearchLabState, LiveExecutorState };

function liveExecutor(env: Env): DurableObjectStub {
  return env.LIVE_EXECUTOR.get(env.LIVE_EXECUTOR.idFromName(LIVE_EXECUTOR_SINGLETON_NAME));
}

function html(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0d10;color:#f5f7fa;margin:0;padding:24px}.card{max-width:560px;margin:24px auto;background:#161a20;border:1px solid #2b313b;border-radius:18px;padding:22px}.ok{color:#5ee69d}.bad{color:#ff7c86}.muted{color:#aab2bf;line-height:1.5}</style></head><body><div class="card">${body}</div></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function rejectTrade(url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  if (!token) return html("Rechazo inválido", '<h1 class="bad">Rechazo inválido</h1><p class="muted">Falta el token de la operación.</p>', 400);

  const response = await liveExecutor(env).fetch("https://live/approval/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = record(await response.json().catch(() => ({})));
  if (!response.ok || result.ok !== true) {
    return html("No se pudo rechazar", '<h1 class="bad">No se pudo rechazar</h1><p class="muted">La autorización ha caducado, ya se utilizó o la orden ya no está preparada. No se ha enviado una nueva orden a Kraken.</p>', 409);
  }
  return html("Operación rechazada", '<h1 class="ok">Operación rechazada</h1><p class="muted">La autorización quedó consumida y la orden preparada fue cancelada antes del envío. No se creó ninguna orden real en Kraken.</p>');
}

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

    if (request.method === "GET" && url.pathname === "/api/live/activation-readiness") {
      return Response.json({
        schemaVersion: "live-activation-readiness-v1",
        ...liveArmingConfigurationStatus(env),
        realOrderCreated: false,
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (
      request.method === "GET"
      && url.pathname === "/api/pilot/authorize-trade"
      && url.searchParams.get("decision") === "reject"
    ) {
      return rejectTrade(url, env);
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
