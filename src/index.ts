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
:root{color-scheme:dark}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1020;color:#fff;margin:0;padding:22px}main{max-width:760px;margin:auto}.card{background:#151c32;border:1px solid #2b3659;border-radius:18px;padding:18px;margin:14px 0}.ok{color:#5ee6a8}.warn{color:#ffd166}.muted{color:#aeb8d4}pre{white-space:pre-wrap;word-break:break-word;font-size:13px}button,input{font:inherit;border-radius:12px}button{padding:12px 14px;border:0;font-weight:700;margin:5px 5px 5px 0;background:#eef2ff;color:#10172c}button:disabled{opacity:.55}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #405078;background:#0e1529;color:#fff;margin:8px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:520px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><h1>Auto Bolsa AI</h1><p class="ok">Modo PAPER obligatorio · Trading real bloqueado</p>
<div class="card"><h2>Simulador automático</h2><pre id="status">Cargando…</pre></div>
<div class="card"><h2>Control privado</h2><p class="muted">El token solo se usa en esta pestaña y no se guarda.</p><input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN de Cloudflare">
<div class="grid"><button onclick="admin('/api/tick','POST')">Ejecutar ciclo ahora</button><button id="krakenButton" onclick="admin('/api/kraken/connection','GET')">Comprobar Kraken</button><button onclick="admin('/api/pause','POST')">Pausar motor</button><button onclick="admin('/api/resume','POST')">Reanudar motor</button></div><pre id="adminResult">Sin comprobaciones todavía.</pre></div>
<p class="warn">Las claves de Kraken nunca se muestran ni se envían al navegador. Las órdenes reales siguen bloqueadas por código.</p>
<script>
let lockoutTimer;
async function load(){try{const r=await fetch('/api/status');const d=await r.json();document.getElementById('status').textContent=JSON.stringify(d,null,2)}catch(e){document.getElementById('status').textContent='Error cargando estado'}}
function startLockout(seconds){clearInterval(lockoutTimer);const button=document.getElementById('krakenButton');let remaining=Math.max(1,Number(seconds)||900);button.disabled=true;const draw=()=>{button.textContent='Kraken bloqueado · '+remaining+' s';remaining-=1;if(remaining<0){clearInterval(lockoutTimer);button.disabled=false;button.textContent='Comprobar Kraken'}};draw();lockoutTimer=setInterval(draw,1000)}
async function admin(path,method){const token=document.getElementById('token').value;const out=document.getElementById('adminResult');if(!token){out.textContent='Introduce primero el ADMIN_TOKEN.';return}out.textContent='Comprobando…';try{const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={status:r.status,response:text}}out.textContent=JSON.stringify(data,null,2);if(data&&data.temporaryLockout)startLockout(data.retryAfterSeconds);if(path!='/api/kraken/connection')load()}catch(e){out.textContent='Error de conexión'}}
load();setInterval(load,15000)
</script></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return dashboard();
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "auto-bolsa-ai", version: "0.3.0", mode: "paper", liveTrading: false }),
        { headers: jsonHeaders },
      );
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return singleton(env).fetch("https://bot/status");
    }
    if (request.method === "GET" && url.pathname === "/api/kraken/connection") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch("https://bot/kraken/connection");
    }
    if (request.method === "POST" && ["/api/tick", "/api/pause", "/api/resume", "/api/reset"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`, { method: "POST" });
    }
    if (url.pathname.startsWith("/api/live")) {
      return Response.json(
        { error: "LIVE_TRADING_HARD_DISABLED", message: "La versión 0.3 solo permite simulación y verificación segura de conexión." },
        { status: 403 },
      );
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(singleton(env).fetch("https://bot/tick", { method: "POST" }).then(() => undefined));
  },
};
