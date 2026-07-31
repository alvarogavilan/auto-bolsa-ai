import { BotState } from "./bot-state";
import type { Env } from "./types";

export { BotState };

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function singleton(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName("auto-bolsa-ai-singleton"));
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function dashboard(): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto Bolsa AI</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1020;color:#fff;margin:0;padding:24px}main{max-width:760px;margin:auto}.card{background:#151c32;border:1px solid #2b3659;border-radius:18px;padding:20px;margin:14px 0}.ok{color:#5ee6a8}.warn{color:#ffd166}pre{white-space:pre-wrap;word-break:break-word}button{padding:12px 16px;border-radius:12px;border:0;font-weight:700;margin-right:8px}</style></head>
<body><main><h1>Auto Bolsa AI</h1><p class="ok">Modo PAPER obligatorio · Trading real bloqueado</p><div class="card"><pre id="status">Cargando…</pre></div>
<p class="warn">Los controles administrativos requieren un token secreto y no se exponen en esta pantalla.</p>
<script>async function load(){const r=await fetch('/api/status');const d=await r.json();document.getElementById('status').textContent=JSON.stringify(d,null,2)}load();setInterval(load,15000)</script></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return dashboard();
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "auto-bolsa-ai", version: "0.1.0", mode: "paper", liveTrading: false }),
        { headers: jsonHeaders },
      );
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return singleton(env).fetch("https://bot/status");
    }
    if (request.method === "POST" && ["/api/tick", "/api/pause", "/api/resume", "/api/reset"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`, { method: "POST" });
    }
    if (url.pathname.startsWith("/api/live")) {
      return Response.json(
        { error: "LIVE_TRADING_HARD_DISABLED", message: "La versión 0.1 solo permite simulación." },
        { status: 403 },
      );
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(singleton(env).fetch("https://bot/tick", { method: "POST" }).then(() => undefined));
  },
};
