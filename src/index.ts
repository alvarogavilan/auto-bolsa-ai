import { BotState } from "./bot-state";
import { analyzeExecutionQuality } from "./execution-quality";
import {
  assessKrakenPermissions,
  fetchApiKeyInfo,
  fingerprintKrakenCredentials,
} from "./kraken";
import { fetchAllTickers, fetchTradableAssetPairs } from "./kraken-markets";
import { fetchPreTradeBook } from "./kraken-pretrade";
import { buildMarketUniverse, type MarketCandidate, type MarketUniverse } from "./market-universe";
import { ResearchLabState } from "./research-lab-state";
import type { Env } from "./types";

export { BotState, ResearchLabState };

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const MARKET_CACHE_TTL_SECONDS = 60 * 60;
const EXECUTION_CACHE_TTL_SECONDS = 5 * 60;

function singleton(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName("auto-bolsa-ai-singleton"));
}

function researchLabSingleton(env: Env): DurableObjectStub {
  return env.RESEARCH_LAB.get(env.RESEARCH_LAB.idFromName("auto-bolsa-ai-research-lab"));
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function marketCacheKey(env: Env): Request {
  const capital = Number(env.INITIAL_CASH_EUR || "50");
  return new Request(`https://cache.auto-bolsa-ai.internal/kraken-eur-markets?capital=${capital}`);
}

function executionCacheKey(env: Env): Request {
  const capital = Number(env.INITIAL_CASH_EUR || "50");
  return new Request(`https://cache.auto-bolsa-ai.internal/pretrade-execution?capital=${capital}`);
}

async function marketUniverse(env: Env, forceRefresh = false): Promise<Response> {
  const cache = caches.default;
  const key = marketCacheKey(env);
  if (!forceRefresh) {
    const cached = await cache.match(key);
    if (cached) return cached;
  }

  try {
    const [pairs, tickers] = await Promise.all([
      fetchTradableAssetPairs(),
      fetchAllTickers(),
    ]);
    const universe = buildMarketUniverse(pairs, tickers, Number(env.INITIAL_CASH_EUR || "50"));
    const response = Response.json(universe, {
      headers: { "Cache-Control": `public, max-age=${MARKET_CACHE_TTL_SECONDS}` },
    });
    await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kraken market universe failed";
    return Response.json(
      {
        schemaVersion: "kraken-eur-market-universe-v1",
        generatedAt: Date.now(),
        available: false,
        error: message,
        liveTrading: false,
      },
      { status: 502 },
    );
  }
}

function preTradeSymbol(candidate: MarketCandidate): string {
  const aliases: Record<string, string> = {
    XBT: "BTC",
    XDG: "DOGE",
  };
  return `${aliases[candidate.base] ?? candidate.base}/EUR`;
}

function executionCandidates(universe: MarketUniverse): MarketCandidate[] {
  const ordered = [
    ...universe.topByLane.fast,
    ...universe.topByLane.intraday,
  ];
  const unique = new Map<string, MarketCandidate>();
  for (const candidate of ordered) {
    if (!unique.has(candidate.pairKey)) unique.set(candidate.pairKey, candidate);
    if (unique.size >= 5) break;
  }
  return [...unique.values()];
}

async function executionQuality(env: Env, forceRefresh = false): Promise<Response> {
  const cache = caches.default;
  const key = executionCacheKey(env);
  if (!forceRefresh) {
    const cached = await cache.match(key);
    if (cached) return cached;
  }

  const universeResponse = await marketUniverse(env);
  if (!universeResponse.ok) {
    return Response.json(
      {
        schemaVersion: "pretrade-execution-quality-report-v1",
        available: false,
        error: "MARKET_UNIVERSE_UNAVAILABLE",
        liveTrading: false,
      },
      { status: 502 },
    );
  }

  const universe = (await universeResponse.json()) as MarketUniverse;
  const candidates = executionCandidates(universe);
  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      const book = await fetchPreTradeBook(preTradeSymbol(candidate));
      return analyzeExecutionQuality(candidate, book, 10);
    } catch (error) {
      return {
        schemaVersion: "pretrade-execution-quality-v1" as const,
        symbol: candidate.symbol,
        pairKey: candidate.pairKey,
        available: false,
        error: error instanceof Error ? error.message : "PreTrade analysis failed",
        fastExecutionEligible: false,
        liveTrading: false as const,
      };
    }
  }));

  const successful = results.filter((result) => "immediateRoundTripCostPct" in result);
  const report = {
    schemaVersion: "pretrade-execution-quality-report-v1",
    generatedAt: Date.now(),
    notionalEur: 10,
    candidatesRequested: candidates.length,
    candidatesMeasured: successful.length,
    fastExecutionEligibleCount: results.filter((result) => result.fastExecutionEligible).length,
    ranked: [...results].sort((left, right) => {
      const leftEligible = left.fastExecutionEligible ? 1 : 0;
      const rightEligible = right.fastExecutionEligible ? 1 : 0;
      if (leftEligible !== rightEligible) return rightEligible - leftEligible;
      const leftCost = "immediateRoundTripCostPct" in left
        ? left.immediateRoundTripCostPct ?? Number.POSITIVE_INFINITY
        : Number.POSITIVE_INFINITY;
      const rightCost = "immediateRoundTripCostPct" in right
        ? right.immediateRoundTripCostPct ?? Number.POSITIVE_INFINITY
        : Number.POSITIVE_INFINITY;
      return leftCost - rightCost;
    }),
    interpretation: {
      immediateRoundTrip: "Simula comprar 10 EUR contra asks y vender la cantidad adquirida contra bids, con 0,40 % de comisión taker por lado.",
      eligibility: "Solo mantiene candidatos cuyo libro cubre ambas patas y cuyo rango de 24 h supera al menos 2,25 veces el coste inmediato.",
      guarantee: "Una lectura favorable no garantiza beneficio y solo autoriza investigación PAPER.",
    },
    eligibleForLiveReview: false,
    liveTrading: false,
  };
  const response = Response.json(report, {
    headers: { "Cache-Control": `public, max-age=${EXECUTION_CACHE_TTL_SECONDS}` },
  });
  await cache.put(key, response.clone());
  return response;
}

async function runResearchLab(env: Env): Promise<Response> {
  const universeResponse = await marketUniverse(env);
  if (!universeResponse.ok) {
    return Response.json(
      {
        initialized: false,
        error: "MARKET_UNIVERSE_UNAVAILABLE",
        marketStatus: universeResponse.status,
        eligibleForLiveReview: false,
        liveTrading: false,
      },
      { status: 502 },
    );
  }

  const universe = (await universeResponse.json()) as MarketUniverse;
  return researchLabSingleton(env).fetch("https://lab/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(universe),
  });
}

function dashboard(): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto Bolsa AI</title><style>
:root{color-scheme:dark}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1020;color:#fff;margin:0;padding:22px}main{max-width:760px;margin:auto}.card{background:#151c32;border:1px solid #2b3659;border-radius:18px;padding:18px;margin:14px 0}.ok{color:#5ee6a8}.warn{color:#ffd166}.danger{color:#ff8585}.muted{color:#aeb8d4}pre{white-space:pre-wrap;word-break:break-word;font-size:13px}button,input{font:inherit;border-radius:12px}button{padding:12px 14px;border:0;font-weight:700;margin:5px 5px 5px 0;background:#eef2ff;color:#10172c}button:disabled{opacity:.55}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #405078;background:#0e1529;color:#fff;margin:8px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.divider{border-top:1px solid #2b3659;margin:18px 0}@media(max-width:520px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><h1>Auto Bolsa AI</h1><p class="ok">Modo PAPER obligatorio · Trading real bloqueado</p>
<div class="card"><h2>Calidad de ejecución rápida</h2><p class="muted">Simula ahora mismo una compra y venta de 10 € contra los diez primeros niveles públicos del libro, incluyendo las dos comisiones taker.</p><pre id="execution">Cargando…</pre></div>
<div class="card"><h2>Laboratorio multihorizonte</h2><p class="muted">Compara cohortes fijas de compra rápida, intradía y medio plazo. Cada estrategia usa 50 € virtuales independientes solo para medir; esos saldos no se suman ni representan dinero disponible.</p><pre id="lab">Cargando…</pre></div>
<div class="card"><h2>Mapa automático de mercados</h2><p class="muted">Clasifica los pares EUR de Kraken para 50 € y compara compra rápida, intradía y medio plazo después de costes.</p><pre id="markets">Cargando…</pre></div>
<div class="card"><h2>Expediente PAPER</h2><p class="muted">La app exige días, velas cerradas, operaciones y métricas mínimas antes de permitir siquiera una revisión humana.</p><pre id="readiness">Cargando…</pre></div>
<div class="card"><h2>Simulador automático</h2><pre id="status">Cargando…</pre></div>
<div class="card"><h2>Control privado</h2><p class="muted">El token solo se usa en esta pestaña y no se guarda.</p><input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN de Cloudflare">
<div class="grid"><button onclick="admin('/api/tick','POST')">Ejecutar ciclo principal</button><button onclick="admin('/api/lab/run','POST')">Ejecutar laboratorio ahora</button><button onclick="admin('/api/execution/refresh','POST')">Actualizar ejecución rápida</button><button onclick="admin('/api/markets/refresh','POST')">Actualizar mapa de mercados</button><button onclick="admin('/api/signals','GET')">Analizar señales PAPER</button><button onclick="admin('/api/checkpoints','GET')">Verificar registro diario</button><button onclick="admin('/api/kraken/diagnostics','GET')">Diagnóstico local</button><button id="krakenButton" onclick="admin('/api/kraken/connection','GET')">Probar conexión Kraken</button><button id="permissionButton" onclick="admin('/api/kraken/permissions','GET')">Auditar permisos Kraken</button><button onclick="admin('/api/pause','POST')">Pausar motor</button><button onclick="admin('/api/resume','POST')">Reanudar motor</button></div><pre id="adminResult">Sin comprobaciones todavía.</pre>
<div class="divider"></div><h3>Comparar la pareja V2 sin enviarla</h3><p class="muted">Pega aquí la clave pública y el secreto V2. El navegador los compara mediante SHA-256; nunca se mandan al servidor y los campos se borran al terminar.</p>
<input id="compareKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Clave pública V2">
<input id="compareSecret" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Secreto privado V2">
<button onclick="compareCredentials()">Comparar con Cloudflare localmente</button><pre id="compareResult">Sin comparación todavía.</pre></div>
<p class="warn">La compra rápida no evita pérdidas. Antes de considerar una oportunidad, el sistema mide spread, profundidad, deslizamiento y las dos comisiones. Todo continúa en PAPER.</p>
<script>
let lockoutTimer;
async function load(){try{const [statusResponse,readinessResponse,marketsResponse,labResponse,executionResponse]=await Promise.all([fetch('/api/status'),fetch('/api/readiness'),fetch('/api/markets'),fetch('/api/lab'),fetch('/api/execution')]);const status=await statusResponse.json();const readiness=await readinessResponse.json();const markets=await marketsResponse.json();const lab=await labResponse.json();const execution=await executionResponse.json();document.getElementById('status').textContent=JSON.stringify(status,null,2);document.getElementById('readiness').textContent=JSON.stringify(readiness,null,2);document.getElementById('markets').textContent=JSON.stringify(markets,null,2);document.getElementById('lab').textContent=JSON.stringify(lab,null,2);document.getElementById('execution').textContent=JSON.stringify(execution,null,2)}catch(e){document.getElementById('status').textContent='Error cargando estado';document.getElementById('readiness').textContent='Error cargando expediente PAPER';document.getElementById('markets').textContent='Error cargando mapa de mercados';document.getElementById('lab').textContent='Error cargando laboratorio';document.getElementById('execution').textContent='Error cargando calidad de ejecución'}}
function startLockout(seconds){clearInterval(lockoutTimer);const button=document.getElementById('krakenButton');let remaining=Math.max(1,Number(seconds)||900);button.disabled=true;const draw=()=>{button.textContent='Kraken bloqueado · '+remaining+' s';remaining-=1;if(remaining<0){clearInterval(lockoutTimer);button.disabled=false;button.textContent='Probar conexión Kraken'}};draw();lockoutTimer=setInterval(draw,1000)}
async function admin(path,method){const token=document.getElementById('token').value;const out=document.getElementById('adminResult');if(!token){out.textContent='Introduce primero el ADMIN_TOKEN.';return}out.textContent='Comprobando…';try{const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={status:r.status,response:text}}out.textContent=JSON.stringify(data,null,2);if(data&&data.temporaryLockout)startLockout(data.retryAfterSeconds);if(path==='/api/kraken/permissions'&&data&&data.auditComplete){document.getElementById('permissionButton').disabled=true;document.getElementById('permissionButton').textContent='Permisos auditados'}if(!path.startsWith('/api/kraken'))load()}catch(e){out.textContent='Error de conexión'}}
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
        JSON.stringify({ ok: true, service: "auto-bolsa-ai", version: "0.16.0", mode: "paper", liveTrading: false }),
        { headers: jsonHeaders },
      );
    }
    if (request.method === "GET" && url.pathname === "/api/status") return singleton(env).fetch("https://bot/status");
    if (request.method === "GET" && url.pathname === "/api/readiness") return singleton(env).fetch("https://bot/readiness");
    if (request.method === "GET" && url.pathname === "/api/markets") return marketUniverse(env);
    if (request.method === "GET" && url.pathname === "/api/execution") return executionQuality(env);
    if (request.method === "GET" && url.pathname === "/api/lab") return researchLabSingleton(env).fetch("https://lab/status");

    if (request.method === "POST" && url.pathname === "/api/lab/run") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return runResearchLab(env);
    }
    if (request.method === "POST" && url.pathname === "/api/execution/refresh") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return executionQuality(env, true);
    }
    if (request.method === "POST" && url.pathname === "/api/markets/refresh") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return marketUniverse(env, true);
    }
    if (request.method === "GET" && url.pathname === "/api/checkpoints") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch("https://bot/checkpoints");
    }
    if (request.method === "GET" && url.pathname === "/api/signals") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch("https://bot/signals");
    }
    if (request.method === "GET" && url.pathname === "/api/kraken/fingerprints") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) return Response.json({ configured: false, networkCallToKraken: false }, { status: 412 });
      return Response.json({ configured: true, networkCallToKraken: false, ...(await fingerprintKrakenCredentials(env.KRAKEN_API_KEY, env.KRAKEN_API_SECRET)), liveTrading: false });
    }
    if (request.method === "GET" && url.pathname === "/api/kraken/permissions") {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) return Response.json({ configured: false, auditComplete: false, liveTrading: false }, { status: 412 });
      try {
        const nonce = (BigInt(Date.now()) * 1000n).toString();
        const info = await fetchApiKeyInfo(env.KRAKEN_API_KEY, env.KRAKEN_API_SECRET, nonce);
        const assessment = assessKrakenPermissions(info.permissions);
        return Response.json({
          configured: true,
          auditComplete: true,
          safePermissions: assessment.safe,
          apiKeyName: info.apiKeyName,
          permissions: info.permissions,
          missingPermissions: assessment.missing,
          forbiddenPermissions: assessment.forbidden,
          withdrawalPermission: info.permissions.includes("withdraw-funds"),
          depositPermission: info.permissions.includes("add-funds"),
          earnPermission: info.permissions.includes("earn-funds"),
          ipRestrictionEnabled: info.ipAllowlist.length > 0,
          expiresAt: info.validUntil && info.validUntil !== "0" ? info.validUntil : null,
          liveTrading: false,
          message: assessment.safe ? "Auditoría superada: la clave tiene los permisos operativos previstos y no permite retirar fondos." : "Auditoría bloqueada: los permisos no coinciden con la política segura.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kraken permission audit failed";
        return Response.json({ configured: true, auditComplete: false, error: message, liveTrading: false }, { status: 502 });
      }
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
        { error: "LIVE_TRADING_HARD_DISABLED", message: "La versión 0.16 solo permite simulación, auditorías, trazabilidad, libros públicos y comparación PAPER." },
        { status: 403 },
      );
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        singleton(env).fetch("https://bot/tick", { method: "POST" }).then(() => undefined),
        runResearchLab(env).then(() => undefined).catch(() => undefined),
        executionQuality(env).then(() => undefined).catch(() => undefined),
      ]).then(() => undefined),
    );
  },
};
