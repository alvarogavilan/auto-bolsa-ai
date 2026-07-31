import { BotState } from "./bot-state";
import { fingerprintKrakenCredentials } from "./kraken";
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
:root{color-scheme:dark}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1020;color:#fff;margin:0;padding:22px}main{max-width:760px;margin:auto}.card{background:#151c32;border:1px solid #2b3659;border-radius:18px;padding:18px;margin:14px 0}.ok{color:#5ee6a8}.warn{color:#ffd166}.muted{color:#aeb8d4}pre{white-space:pre-wrap;word-break:break-word;font-size:13px}button,input{font:inherit;border-radius:12px}button{padding:12px 14px;border:0;font-weight:700;margin:5px 5px 5px 0;background:#eef2ff;color:#10172c}button:disabled{opacity:.55}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #405078;background:#0e1529;color:#fff;margin:8px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.divider{border-top:1px solid #2b3659;margin:18px 0}@media(max-width:520px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><h1>Auto Bolsa AI</h1><p class="ok">Modo PAPER obligatorio · Trading real bloqueado</p>
<div class="card"><h2>Simulador automático</h2><pre id="status">Cargando…</pre></div>
<div class="card"><h2>Control privado</h2><p class="muted">El token solo se usa en esta pestaña y no se guarda.</p><input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN de Cloudflare">
<div class="grid"><button onclick="admin('/api/tick','POST')">Ejecutar ciclo ahora</button><button onclick="admin('/api/kraken/diagnostics','GET')">Diagnóstico local</button><button id="krakenButton" onclick="admin('/api/kraken/connection','GET')">Probar conexión Kraken</button><button onclick="admin('/api/pause','POST')">Pausar motor</button><button onclick="admin('/api/resume','POST')">Reanudar motor</button></div><pre id="adminResult">Sin comprobaciones todavía.</pre>
<div class="divider"></div><h3>Comparar la pareja V2 sin enviarla</h3><p class="muted">Pega aquí la clave pública y el secreto V2. El navegador los compara mediante SHA-256; nunca se mandan al servidor y los campos se borran al terminar.</p>
<input id="compareKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Clave pública V2">
<input id="compareSecret" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Secreto privado V2">
<button onclick="compareCredentials()">Comparar con Cloudflare localmente</button><pre id="compareResult">Sin comparación todavía.</pre></div>
<p class="warn">El diagnóstico y la comparación local no contactan con Kraken. Las órdenes reales siguen bloqueadas por código.</p>
<script>
let lockoutTimer;
async function load(){try{const r=await fetch('/api/status');const d=await r.json();document.getElementById('status').textContent=JSON.stringify(d,null,2)}catch(e){document.getElementById('status').textContent='Error cargando estado'}}
function startLockout(seconds){clearInterval(lockoutTimer);const button=document.getElementById('krakenButton');let remaining=Math.max(1,Number(seconds)||900);button.disabled=true;const draw=()=>{button.textContent='Kraken bloqueado · '+remaining+' s';remaining-=1;if(remaining<0){clearInterval(lockoutTimer);button.disabled=false;button.textContent='Probar conexión Kraken'}};draw();lockoutTimer=setInterval(draw,1000)}
async function admin(path,method){const token=document.getElementById('token').value;const out=document.getElementById('adminResult');if(!token){out.textContent='Introduce primero el ADMIN_TOKEN.';return}out.textContent='Comprobando…';try{const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={status:r.status,response:text}}out.textContent=JSON.stringify(data,null,2);if(data&&data.temporaryLockout)startLockout(data.retryAfterSeconds);if(!path.startsWith('/api/kraken'))load()}catch(e){out.textContent='Error de conexión'}}
function normalizeLocal(value){let normalized=value.trim();if(normalized.length>=2&&((normalized.startsWith('"')&&normalized.endsWith('"'))||(normalized.startsWith("'")&&normalized.endsWith("'"))))normalized=normalized.slice(1,-1);return normalized.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g,'')}
async function sha256Prefix(value){const bytes=new TextEncoder().encode(normalizeLocal(value));const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(digest.slice(0,8),b=>b.toString(16).padStart(2,'0')).join('')}
async function compareCredentials(){const token=document.getElementById('token').value;const keyInput=document.getElementById('compareKey');const secretInput=document.getElementById('compareSecret');const out=document.getElementById('compareResult');if(!token){out.textContent='Introduce primero el ADMIN_TOKEN.';return}if(!keyInput.value||!secretInput.value){out.textContent='Pega la clave pública y el secreto V2 en los dos campos.';return}out.textContent='Comparando localmente…';try{const r=await fetch('/api/kraken/fingerprints',{headers:{Authorization:'Bearer '+token}});const server=await r.json();const keyFingerprint=await sha256Prefix(keyInput.value);const secretFingerprint=await sha256Prefix(secretInput.value);const result={networkCallToKraken:false,apiKeyMatches:keyFingerprint===server.apiKeyFingerprint,apiSecretMatches:secretFingerprint===server.apiSecretFingerprint,bothMatch:keyFingerprint===server.apiKeyFingerprint&&secretFingerprint===server.apiSecretFingerprint,message:keyFingerprint===server.apiKeyFingerprint&&secretFingerprint===server.apiSecretFingerprint?'Cloudflare contiene exactamente la pareja introducida.':'Al menos uno de los dos valores de Cloudflare no coincide con la pareja introducida.'};out.textContent=JSON.stringify(result,null,2)}catch(e){out.textContent='No se pudo completar la comparación local.'}finally{keyInput.value='';secretInput.value=''}}
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
        JSON.stringify({ ok: true, service: "auto-bolsa-ai", version: "0.7.0", mode: "paper", liveTrading: false }),
        { headers: jsonHeaders },
      );
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return singleton(env).fetch("https://bot/status");
    }
    if (request.method === "GET" && url.pathname === "/api/kraken/fingerprints") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
        return Response.json({ configured: false, networkCallToKraken: false }, { status: 412 });
      }
      return Response.json({
        configured: true,
        networkCallToKraken: false,
        ...(await fingerprintKrakenCredentials(env.KRAKEN_API_KEY, env.KRAKEN_API_SECRET)),
        liveTrading: false,
      });
    }
    if (request.method === "GET" && ["/api/kraken/connection", "/api/kraken/diagnostics"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`);
    }
    if (request.method === "POST" && ["/api/tick", "/api/pause", "/api/resume", "/api/reset"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`, { method: "POST" });
    }
    if (url.pathname.startsWith("/api/live")) {
      return Response.json(
        { error: "LIVE_TRADING_HARD_DISABLED", message: "La versión 0.7 solo permite simulación y diagnósticos seguros." },
        { status: 403 },
      );
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(singleton(env).fetch("https://bot/tick", { method: "POST" }).then(() => undefined));
  },
};
