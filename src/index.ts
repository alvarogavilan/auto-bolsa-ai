import { BotState } from "./bot-state";
import { demoDashboard } from "./demo-dashboard";
import { analyzeExecutionQuality } from "./execution-quality";
import { fingerprintKrakenCredentials } from "./kraken";
import { fetchAllTickers, fetchTradableAssetPairs } from "./kraken-markets";
import { fetchPreTradeBook } from "./kraken-pretrade";
import { buildMarketUniverse, type MarketCandidate, type MarketUniverse } from "./market-universe";
import { type FastEntryGate } from "./research-lab";
import { ResearchLabState } from "./research-lab-state";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

// `LiveExecutorState` (src/live-executor-state.ts) NO se exporta ni se enlaza
// aquí a propósito: no está declarado en wrangler.jsonc, no tiene binding, y
// por tanto Cloudflare nunca lo instancia ni lo despliega. Solo existe como
// código fuente, typecheckeado y usado por sus tests, hasta que un piloto
// manual decida activarlo explícitamente (ver docs/live-executor.md).
export { BotState, ResearchLabState };

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const MARKET_CACHE_TTL_SECONDS = 60 * 60;
const EXECUTION_CACHE_TTL_SECONDS = 5 * 60;

function singleton(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
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
  const aliases: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };
  return `${aliases[candidate.base] ?? candidate.base}/EUR`;
}

function executionCandidates(universe: MarketUniverse): MarketCandidate[] {
  const ordered = [...universe.topByLane.fast, ...universe.topByLane.intraday];
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

function executionGatesFromReport(value: unknown): Record<string, FastEntryGate> {
  if (!value || typeof value !== "object") return {};
  const report = value as { generatedAt?: unknown; ranked?: unknown };
  if (!Array.isArray(report.ranked)) return {};
  const reportGeneratedAt = typeof report.generatedAt === "number" ? report.generatedAt : Date.now();
  const gates: Record<string, FastEntryGate> = {};
  for (const raw of report.ranked) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      pairKey?: unknown;
      generatedAt?: unknown;
      fastExecutionEligible?: unknown;
      immediateRoundTripCostPct?: unknown;
      blocker?: unknown;
      error?: unknown;
    };
    if (typeof item.pairKey !== "string") continue;
    gates[item.pairKey] = {
      checkedAt: typeof item.generatedAt === "number" ? item.generatedAt : reportGeneratedAt,
      allowed: item.fastExecutionEligible === true,
      costPct: typeof item.immediateRoundTripCostPct === "number" ? item.immediateRoundTripCostPct : null,
      blocker: typeof item.blocker === "string"
        ? item.blocker
        : typeof item.error === "string" ? item.error : null,
    };
  }
  return gates;
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
  const executionResponse = await executionQuality(env);
  const executionGates = executionResponse.ok
    ? executionGatesFromReport(await executionResponse.json())
    : {};
  return researchLabSingleton(env).fetch("https://lab/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ universe, executionGates }),
  });
}

function technicalDashboard(): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Bolsa AI · Técnico</title><style>:root{color-scheme:dark}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1020;color:#fff;margin:0;padding:20px}main{max-width:820px;margin:auto}.card{background:#151c32;border:1px solid #2b3659;border-radius:18px;padding:17px;margin:13px 0}.ok{color:#5ee6a8}.muted{color:#aeb8d4}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:420px;overflow:auto}button,input,a{font:inherit;border-radius:12px}button,a{display:inline-block;padding:11px 13px;border:0;font-weight:700;margin:5px 5px 5px 0;background:#eef2ff;color:#10172c;text-decoration:none}input{width:100%;padding:12px;background:#0e1529;color:#fff;border:1px solid #405078;margin:7px 0;box-sizing:border-box}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:560px){.grid{grid-template-columns:1fr}}</style></head><body><main><a href="/demo">← Volver al DEMO visual</a><h1>Panel técnico</h1><p class="ok">PAPER obligatorio · LIVE bloqueado</p><div class="card"><h2>Estados internos</h2><div class="grid"><button onclick="show('/api/lab','lab')">Laboratorio</button><button onclick="show('/api/readiness','readiness')">Readiness</button><button onclick="show('/api/status','status')">Motor principal</button><button onclick="show('/api/execution','execution')">Ejecución rápida</button></div><pre id="output">Pulsa una sección para ver el JSON.</pre></div><div class="card"><h2>Control privado</h2><p class="muted">El token solo permanece en esta pestaña.</p><input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN"><div class="grid"><button onclick="admin('/api/tick','POST')">Ciclo principal</button><button onclick="admin('/api/lab/run','POST')">Ciclo laboratorio</button><button onclick="admin('/api/execution/refresh','POST')">Actualizar ejecución</button><button onclick="admin('/api/markets/refresh','POST')">Actualizar mercados</button><button onclick="admin('/api/signals','GET')">Señales</button><button onclick="admin('/api/checkpoints','GET')">Registro diario</button><button onclick="admin('/api/kraken/connection','GET')">Conexión Kraken</button><button onclick="admin('/api/kraken/permissions','GET')">Permisos Kraken</button><button onclick="admin('/api/pause','POST')">Pausar</button><button onclick="admin('/api/resume','POST')">Reanudar</button></div><pre id="adminResult">Sin acciones.</pre></div><div class="card"><h2>Comparación local de credenciales</h2><p class="muted">Los valores se comparan en tu navegador mediante SHA-256 y no se envían.</p><input id="compareKey" type="password" autocomplete="off" placeholder="Clave pública"><input id="compareSecret" type="password" autocomplete="off" placeholder="Secreto privado"><button onclick="compareCredentials()">Comparar</button><pre id="compareResult">Sin comparación.</pre></div><script>async function show(path){const out=document.getElementById('output');out.textContent='Cargando…';try{const r=await fetch(path,{cache:'no-store'});out.textContent=JSON.stringify(await r.json(),null,2)}catch(e){out.textContent='Error de conexión'}}async function admin(path,method){const token=document.getElementById('token').value;const out=document.getElementById('adminResult');if(!token){out.textContent='Introduce primero el ADMIN_TOKEN.';return}out.textContent='Comprobando…';try{const r=await fetch(path,{method:method,headers:{Authorization:'Bearer '+token}});const text=await r.text();try{out.textContent=JSON.stringify(JSON.parse(text),null,2)}catch(e){out.textContent=text}}catch(e){out.textContent='Error de conexión'}}function normalizeLocal(value){return value.trim().replace(/[\\s\\u200B-\\u200D\\u2060\\uFEFF]/g,'')}async function sha256Prefix(value){const bytes=new TextEncoder().encode(normalizeLocal(value));const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(digest.slice(0,8),function(b){return b.toString(16).padStart(2,'0')}).join('')}async function compareCredentials(){const token=document.getElementById('token').value;const key=document.getElementById('compareKey');const secret=document.getElementById('compareSecret');const out=document.getElementById('compareResult');if(!token||!key.value||!secret.value){out.textContent='Completa token, clave y secreto.';return}try{const r=await fetch('/api/kraken/fingerprints',{headers:{Authorization:'Bearer '+token}});const server=await r.json();const keyFingerprint=await sha256Prefix(key.value);const secretFingerprint=await sha256Prefix(secret.value);const both=keyFingerprint===server.apiKeyFingerprint&&secretFingerprint===server.apiSecretFingerprint;out.textContent=both?'Cloudflare contiene exactamente esta pareja.':'La pareja no coincide completamente.'}catch(e){out.textContent='No se pudo comparar.'}finally{key.value='';secret.value=''}}</script></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/demo")) return demoDashboard();
    if (request.method === "GET" && url.pathname === "/technical") return technicalDashboard();
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "auto-bolsa-ai", version: "0.17.0", mode: "paper", liveTrading: false }),
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
    if (request.method === "GET" && ["/api/kraken/connection", "/api/kraken/diagnostics", "/api/kraken/permissions"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`);
    }
    if (request.method === "POST" && ["/api/tick", "/api/pause", "/api/resume", "/api/reset"].includes(url.pathname)) {
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return singleton(env).fetch(`https://bot${url.pathname.replace("/api", "")}`, { method: "POST" });
    }
    if (url.pathname.startsWith("/api/live")) {
      return Response.json(
        {
          error: "LIVE_TRADING_HARD_DISABLED",
          message: "La versión 0.17 solo permite simulación y exige evidencia pública reciente para cualquier entrada rápida PAPER.",
        },
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
      ]).then(() => undefined),
    );
  },
};
