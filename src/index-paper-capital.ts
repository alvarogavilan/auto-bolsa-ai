import worker, {
  BotState,
  ResearchLabState,
} from "./index-fire-drill";
import { LiveExecutorState } from "./live-executor-state-protected";
import { krakenGoldReadinessResponse } from "./index-kraken-gold";
import { derivePaperEconomicPerformance, type PaperEconomicStrategyLike } from "./paper-economic-performance";
import { BOT_STATE_SINGLETON_NAME, LIVE_EXECUTOR_SINGLETON_NAME, type Env } from "./types";
import { buildNativeXauFastPriceInput, buildNativeXauPaperInput } from "./xau-native-paper-feed";
import { runXauPaxgLiveCycle } from "./xau-paxg-live-orchestrator-guarded";
import { loadSignalInputs, readSignalAlertState, runSignalAlerts, sendTelegramText } from "./signal-alerts-runner";
import { planSignalAlerts } from "./signal-alerts";
import { buildOrderNow } from "./order-now";
import { homeOrderScreen } from "./home-order-screen";
import type { KrakenTicker } from "./kraken-markets";
import { executionVenue, fetchVenueTickers } from "./execution-venue";
import { buildNewsIntelligence } from "./news-intelligence";
import { fetchWorldBoard, fetchWorldRadar } from "./world-radar";
import { radarScreen } from "./radar-screen";
import { TRACKED, evaluateRadarTrack, parseRadarTrack, type RadarSnapshot } from "./radar-track-record";
import { findTicker } from "./order-now";
import { appInstallResponse } from "./app-install";
import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export { BotState, ResearchLabState, LiveExecutorState };

const XAU_FAST_INTERVAL_MS = 3_000;
const XAU_FAST_SAMPLES_PER_MINUTE = 19;
const XAU_BLOCKER_DIAGNOSTIC_WINDOW = 50;
const XAU_SCHEDULER_STALE_MS = 3 * 60_000;

function paperRuntimeEnv(env: Env): Env {
  if (env.INITIAL_CASH_EUR) return env;
  return { ...env, INITIAL_CASH_EUR: "100" };
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function liveExecutor(env: Env): DurableObjectStub {
  return env.LIVE_EXECUTOR.get(env.LIVE_EXECUTOR.idFromName(LIVE_EXECUTOR_SINGLETON_NAME));
}

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] ?? character));
}

function approvalHtml(title: string, content: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0d10;color:#f5f7fa;margin:0;padding:24px}.card{max-width:560px;margin:24px auto;background:#161a20;border:1px solid #2b313b;border-radius:18px;padding:22px}h1{font-size:23px}.row{display:flex;justify-content:space-between;gap:18px;padding:9px 0;border-bottom:1px solid #252b34}.muted{color:#aab2bf;font-size:14px;line-height:1.5}.ok{color:#5ee69d}.bad{color:#ff7c86}button{width:100%;padding:15px;border:0;border-radius:12px;font-size:17px;font-weight:700;background:#f5f7fa;color:#111;margin-top:18px}button:disabled{opacity:.45}</style></head><body><div class="card">${content}</div></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
  });
}

async function tradeApprovalResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = request.method === "POST"
    ? String((await request.formData()).get("token") ?? "")
    : String(url.searchParams.get("token") ?? "");
  if (!token) return approvalHtml("Autorización inválida", '<h1 class="bad">Autorización inválida</h1><p class="muted">Falta el token de una sola operación.</p>', 400);

  const inspectResponse = await liveExecutor(env).fetch(`https://live/approval/inspect?token=${encodeURIComponent(token)}`);
  const inspected = record(await inspectResponse.json().catch(() => ({})));
  if (!inspectResponse.ok || inspected.ok !== true) {
    return approvalHtml("Autorización caducada", '<h1 class="bad">Autorización caducada o utilizada</h1><p class="muted">No se ha enviado ninguna orden.</p>', 410);
  }
  const order = record(inspected.order);
  const notional = Number(order.notionalEur);
  const limitPrice = Number(order.limitPrice);
  const pair = String(order.pair ?? "PAXGEUR");
  const side = String(order.side ?? "buy");
  const expiresAt = Number(inspected.expiresAt);

  if (request.method === "GET") {
    const liveArmed = env.LIVE_TRADING_ENABLED === "true" && env.TRADING_MODE === "live" && env.PAIR === "PAXGEUR";
    return approvalHtml("Autorizar operación Auto Bolsa", `<h1>Autorizar operación</h1><div class="row"><span>Mercado</span><strong>${escapeHtml(pair)}</strong></div><div class="row"><span>Acción</span><strong>${escapeHtml(side.toUpperCase())}</strong></div><div class="row"><span>Máximo</span><strong>${Number.isFinite(notional) ? notional.toFixed(2) : "—"} €</strong></div><div class="row"><span>Precio límite</span><strong>${Number.isFinite(limitPrice) ? escapeHtml(limitPrice) : "—"}</strong></div><div class="row"><span>Caduca</span><strong>${Number.isFinite(expiresAt) ? escapeHtml(new Date(expiresAt).toLocaleTimeString("es-ES")) : "—"}</strong></div><p class="muted">Kraken ya aceptó esta orden con validate=true. Abrir este enlace no ejecuta nada. La operación solo se envía al pulsar el botón inferior y únicamente si LIVE está armado.</p>${liveArmed ? '<p class="ok">LIVE armado para autorización individual.</p>' : '<p class="bad">LIVE todavía no está armado; este botón no podrá ejecutar hasta que lo esté.</p>'}<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" ${liveArmed ? "" : "disabled"}>Confirmar esta operación</button></form>`);
  }

  const liveArmed = env.LIVE_TRADING_ENABLED === "true" && env.TRADING_MODE === "live" && env.PAIR === "PAXGEUR";
  if (!liveArmed) return approvalHtml("LIVE no armado", '<h1 class="bad">LIVE no está armado</h1><p class="muted">No se ha enviado ninguna orden.</p>', 409);

  const authorizeResponse = await liveExecutor(env).fetch("https://live/approval/authorize", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  });
  const authorization = record(await authorizeResponse.json().catch(() => ({})));
  if (!authorizeResponse.ok || authorization.ok !== true) return approvalHtml("No autorizado", '<h1 class="bad">No se pudo autorizar</h1><p class="muted">La autorización ha caducado o ya fue utilizada. No se ha enviado una nueva orden.</p>', 409);
  const clOrdId = String(authorization.clOrdId ?? "");

  if (side === "sell") {
    const released = await liveExecutor(env).fetch("https://live/protection/release-for-exit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!released.ok) return approvalHtml("Protección no liberada", '<h1 class="bad">Salida bloqueada</h1><p class="muted">No se pudo liberar de forma verificada el stop anterior. No se envió la salida.</p>', 409);
  }

  const submitResponse = await liveExecutor(env).fetch("https://live/submit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clOrdId }),
  });
  const submitted = record(await submitResponse.json().catch(() => ({})));
  if (!submitResponse.ok || submitted.ok !== true) {
    await liveExecutor(env).fetch("https://live/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    return approvalHtml("Envío bloqueado", '<h1 class="bad">Kraken no confirmó el envío</h1><p class="muted">El sistema entró en recuperación/reconciliación y no reenviará automáticamente esta autorización.</p>', 409);
  }

  const reconcileResponse = await liveExecutor(env).fetch("https://live/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!reconcileResponse.ok) return approvalHtml("Reconciliación pendiente", '<h1 class="bad">Orden enviada; reconciliación bloqueada</h1><p class="muted">No se enviará una segunda orden. El ejecutor queda fail-closed hasta resolver la evidencia de Kraken.</p>', 409);
  return approvalHtml("Operación confirmada", '<h1 class="ok">Operación confirmada por Kraken</h1><p class="muted">La orden se envió una sola vez, fue reconciliada y la protección de oro se verificó antes de considerar el ciclo completo.</p>');
}

function strategiesFromLabPayload(payload: unknown): PaperEconomicStrategyLike[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const candidates = [root.strategies, root.state && typeof root.state === "object" ? (root.state as Record<string, unknown>).strategies : null, root.lab && typeof root.lab === "object" ? (root.lab as Record<string, unknown>).strategies : null];
  const raw = candidates.find(Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const strategy = entry as Record<string, unknown>;
    if (typeof strategy.id !== "string" || typeof strategy.symbol !== "string" || !Array.isArray(strategy.trades)) return [];
    return [{ id: strategy.id, symbol: strategy.symbol, trades: strategy.trades as PaperEconomicStrategyLike["trades"] }];
  });
}

async function paperEconomicsResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const labUrl = new URL("/api/lab", request.url);
  const labResponse = await worker.fetch(new Request(labUrl, { headers: { Accept: "application/json" } }), env, ctx);
  if (!labResponse.ok) return Response.json({ schemaVersion: "paper-economic-performance-v1", mode: "paper", available: false, blocker: `Lab HTTP ${labResponse.status}`, liveTrading: false, realOrderSubmission: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const payload = await labResponse.json<unknown>();
  const performance = derivePaperEconomicPerformance(strategiesFromLabPayload(payload));
  return Response.json({ schemaVersion: "paper-economic-performance-v1", mode: "paper", available: true, minimumMeaningfulNetProfitEur: 0.5, ...performance, liveTrading: false, realOrderSubmission: false }, { headers: { "Cache-Control": "no-store" } });
}

async function xauStatus(env: Env): Promise<Record<string, unknown>> {
  const response = await botState(env).fetch("https://bot/xau/status");
  if (!response.ok) throw new Error(`XAU status HTTP ${response.status}`);
  return response.json<Record<string, unknown>>();
}

function isXauDecisionCycle(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== "object") return false;
  const instruction = (entry as Record<string, unknown>).instruction;
  if (!instruction || typeof instruction !== "object") return true;
  return (instruction as Record<string, unknown>).cycleKind !== "monitoring";
}

function latestXauDecisionCycle(status: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(status.cycles)) return null;
  return status.cycles.find(isXauDecisionCycle) ?? null;
}

function xauBlockerDiagnostics(status: Record<string, unknown>) {
  if (!Array.isArray(status.cycles)) return { sampleSize: 0, blockedDecisions: 0, dominantBlocker: null, dominantBlockerCount: 0, blockerFrequency: [] as Array<{ blocker: string; count: number }> };
  const decisions = status.cycles.filter(isXauDecisionCycle).slice(0, XAU_BLOCKER_DIAGNOSTIC_WINDOW);
  const blocked = decisions.filter((cycle) => cycle.outcome === "blocked");
  const counts = new Map<string, number>();
  for (const cycle of blocked) {
    if (!Array.isArray(cycle.blockers)) continue;
    for (const blocker of cycle.blockers) if (typeof blocker === "string" && blocker.trim()) counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
  }
  const blockerFrequency = [...counts.entries()].map(([blocker, count]) => ({ blocker, count })).sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
  return { sampleSize: decisions.length, blockedDecisions: blocked.length, dominantBlocker: blockerFrequency[0]?.blocker ?? null, dominantBlockerCount: blockerFrequency[0]?.count ?? 0, blockerFrequency };
}

async function xauDecisionInput(env: Env): Promise<XauPaperRuntimeInput> {
  if (env.XAU_PAPER_FEED_URL) {
    const response = await fetch(env.XAU_PAPER_FEED_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`XAU feed HTTP ${response.status}`);
    return response.json<XauPaperRuntimeInput>();
  }
  return buildNativeXauPaperInput();
}

async function xauFeedDiagnostic(env: Env, now = Date.now()) {
  try {
    const input = await xauDecisionInput(env);
    return { checkedAt: now, ok: true, source: typeof input.quote?.source === "string" ? input.quote.source : null, quoteAgeMs: typeof input.quote?.observedAt === "number" ? Math.max(0, now - input.quote.observedAt) : null, macroSourcesAvailable: Number(input.cabinet?.macro?.sourcesAvailable) || 0, macroSourcesFresh: Number(input.cabinet?.macro?.sourcesFresh) || 0, error: null };
  } catch (error) {
    return { checkedAt: now, ok: false, source: null, quoteAgeMs: null, macroSourcesAvailable: 0, macroSourcesFresh: 0, error: error instanceof Error ? error.message : "Unknown XAU feed failure" };
  }
}

async function xauReadinessResponse(env: Env): Promise<Response> {
  const runtimeEnv = paperRuntimeEnv(env);
  const [status, feedDiagnostic] = await Promise.all([xauStatus(runtimeEnv), xauFeedDiagnostic(runtimeEnv)]);
  const externalFeedConfigured = Boolean(runtimeEnv.XAU_PAPER_FEED_URL?.trim());
  const metrics = status.metrics && typeof status.metrics === "object" ? status.metrics as Record<string, unknown> : {};
  const cycles = typeof metrics.cycles === "number" ? metrics.cycles : 0;
  const decisionCycles = typeof metrics.decisionCycles === "number" ? metrics.decisionCycles : (typeof metrics.approved === "number" ? metrics.approved : 0) + (typeof metrics.blocked === "number" ? metrics.blocked : 0);
  const monitoringSamples = typeof metrics.monitoringSamples === "number" ? metrics.monitoringSamples : Math.max(0, cycles - decisionCycles);
  const approved = typeof metrics.approved === "number" ? metrics.approved : 0;
  const blocked = typeof metrics.blocked === "number" ? metrics.blocked : 0;
  const latestDecisionCycle = latestXauDecisionCycle(status);
  const latestDecisionOutcome = typeof latestDecisionCycle?.outcome === "string" ? latestDecisionCycle.outcome : null;
  const latestDecisionBlockers = Array.isArray(latestDecisionCycle?.blockers) ? latestDecisionCycle.blockers.filter((value): value is string => typeof value === "string") : [];
  const latestDecisionObservedAt = typeof latestDecisionCycle?.observedAt === "number" ? latestDecisionCycle.observedAt : null;
  const latestDecisionAgeMs = latestDecisionObservedAt === null ? null : Math.max(0, Date.now() - latestDecisionObservedAt);
  const schedulerStalled = latestDecisionAgeMs === null || latestDecisionAgeMs > XAU_SCHEDULER_STALE_MS;
  const blockerDiagnostics = xauBlockerDiagnostics(status);
  const macroReady = feedDiagnostic.macroSourcesFresh >= 3;
  const runtimeBlockers = [...(!feedDiagnostic.ok && feedDiagnostic.error ? [`XAU_FEED_UNAVAILABLE: ${feedDiagnostic.error}`] : []), ...(schedulerStalled ? ["XAU_SCHEDULER_STALLED: no hay una decisión persistida en los últimos 3 minutos"] : [])];
  return Response.json({ schemaVersion: "xau-usd-paper-readiness-v6", market: "XAU/USD", mode: "paper", operational: feedDiagnostic.ok && !schedulerStalled, marketObservationEnabled: true, entryProfile: externalFeedConfigured || macroReady ? "full-technical-macro" : "strict-technical-paper-fallback", feedMode: externalFeedConfigured ? "external-plus-native-fast-price" : "native-kraken-xaut-plus-official-macro", externalFeedConfigured, feedDiagnostic, automaticCycleEnabled: true, schedulerCron: "* * * * *", schedulerStalled, latestDecisionObservedAt, latestDecisionAgeMs, schedulerStaleAfterMs: XAU_SCHEDULER_STALE_MS, priceMonitoringIntervalSeconds: XAU_FAST_INTERVAL_MS / 1_000, fastSamplesPerMinute: XAU_FAST_SAMPLES_PER_MINUTE, decisionReanalysisSeconds: 60, baseStrategyCycleMinutes: 5, totalObservations: cycles, decisionCycles, monitoringSamples, approvedDecisionCycles: approved, blockedDecisionCycles: blocked, latestDecisionOutcome, latestDecisionBlockers, blockerDiagnostics, status, paperEntryCapable: feedDiagnostic.ok, paperEntryRequirements: externalFeedConfigured || macroReady ? ["Consenso técnico y macro completo", "evidencia fresca", "asimetría y spread válidos"] : ["Unanimidad técnica 100 %", "spread <= 0,05 %", "asimetría >= 2,5R", "sin veto de riesgo"], blockers: [...runtimeBlockers, ...(latestDecisionOutcome === "blocked" ? latestDecisionBlockers : [])], liveTrading: false, realOrderSubmission: false }, { headers: { "Cache-Control": "no-store" } });
}

async function submitXauCycle(env: Env, input: XauPaperRuntimeInput): Promise<void> {
  const response = await botState(env).fetch("https://bot/xau/cycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok && response.status !== 202) throw new Error(`XAU cycle HTTP ${response.status}`);
}

async function runXauDecisionCycle(env: Env): Promise<void> { await submitXauCycle(env, await xauDecisionInput(env)); }

async function xauPaperPositionOpen(env: Env): Promise<boolean> {
  try {
    const response = await botState(env).fetch("https://bot/xau/status-lite");
    if (!response.ok) return true;
    const status = await response.json<{ positionBook?: { open?: unknown } }>();
    return Boolean(status.positionBook?.open);
  } catch {
    return true;
  }
}

async function runXauFastMonitoringSamples(env: Env): Promise<void> {
  // El muestreo cada 3 s solo sirve para detectar el stop de una posición
  // abierta. Sin posición no hay nada que vigilar: no se gasta cuota.
  if (!(await xauPaperPositionOpen(env))) return;
  for (let sample = 0; sample < XAU_FAST_SAMPLES_PER_MINUTE; sample += 1) {
    await sleep(XAU_FAST_INTERVAL_MS);
    try { await submitXauCycle(env, await buildNativeXauFastPriceInput()); } catch { /* siguiente muestra */ }
    // Las salidas (stop) del oro se detectan aquí, segundos después de producirse.
    if (!liveArmed(env) && sample % 3 === 2) {
      try { await runSignalAlerts(env, { includeCrypto: false }); } catch { /* siguiente muestra */ }
    }
  }
}

function liveArmed(env: Env): boolean {
  return env.LIVE_TRADING_ENABLED === "true" && env.TRADING_MODE === "live" && (env.PAIR || "") === "PAXGEUR";
}

async function signalStatusResponse(env: Env): Promise<Response> {
  const state = await readSignalAlertState(env);
  const holdings = Object.values(state.holdings);
  return Response.json({
    schemaVersion: "signal-alert-status-v1",
    telegramConfigured: Boolean((env.TELEGRAM_BOT_TOKEN || env.BETPRO_TELEGRAM_BOT_TOKEN) && (env.TELEGRAM_CHAT_ID || env.BETPRO_TELEGRAM_CHAT_ID)),
    resumen: holdings.length === 0
      ? "Sin posiciones abiertas. Espera a recibir «🟢 COMPRA AHORA»."
      : holdings.map((holding) => `Tienes ${holding.asset} de la alerta ${holding.alertId}: espera «🔴 VENDE AHORA».`).join(" "),
    holdings,
    recentAlerts: state.log.slice(0, 20),
    realOrderSubmission: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

/** Respuesta segura cuando no se puede leer el estado: nunca una orden, siempre el motivo. */
function orderNowUnavailable(env: Env, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const quota = /free tier|Exceeded allowed/i.test(message);
  const reason = quota
    ? "Se ha agotado la cuota diaria gratuita de Cloudflare. El motor vuelve a funcionar a las 00:00 UTC (01:00 en España peninsular en invierno)."
    : `No se puede leer el estado del motor: ${message.slice(0, 160)}`;
  return Response.json({
    schemaVersion: "order-now-v1",
    generatedAt: Date.now(),
    dataFresh: false,
    staleReason: reason,
    latestDecisionAt: null,
    primary: { action: "wait", headline: "NO OPERES · motor detenido", asset: null, displayPair: null, alertId: null, steps: ["No compres ni vendas nada basándote en esta pantalla.", "Si tienes una posición abierta por una alerta anterior, vigílala tú en Crypto.com hasta que el motor vuelva."], warnings: [], reason, evidence: null, expiresAt: null, priceEur: null, resultPct: null },
    others: [],
    team: null,
    market: [],
    discarded: [],
    venue: executionVenue(env),
    realOrderSubmission: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function orderNowResponse(env: Env): Promise<Response> {
  const now = Date.now();
  let inputs: Awaited<ReturnType<typeof loadSignalInputs>>;
  try { inputs = await loadSignalInputs(env); } catch (error) { return orderNowUnavailable(env, error); }
  const { state, xauStatus, labView } = inputs;
  const plan = planSignalAlerts({ xauStatus, lab: labView, holdings: state.holdings, now, includeGold: xauStatus !== null, includeCrypto: labView !== null });
  const pairs = new Set<string>(["PAXGEUR", "XBTEUR", "ETHEUR"]);
  for (const holding of Object.values(state.holdings)) pairs.add(holding.pair);
  for (const buy of plan.buys) pairs.add(buy.pair);
  let tickers: Record<string, KrakenTicker> = {};
  let tickersAvailable = true;
  try { tickers = await fetchVenueTickers(env, [...pairs]); } catch { tickersAvailable = false; }
  return Response.json(buildOrderNow({ now, xauStatus, holdings: state.holdings, plan, tickers, tickersAvailable, venue: executionVenue(env) }), { headers: { "Cache-Control": "no-store" } });
}

const NEWS_BRIEF_TTL_SECONDS = 120;

async function newsBriefResponse(request: Request, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(new URL("/api/news-brief", request.url).toString());
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const report = await buildNewsIntelligence();
  const response = Response.json({
    schemaVersion: "news-brief-v1",
    generatedAt: report.generatedAt,
    sourcesConfigured: report.sourcesConfigured,
    sourcesAvailable: report.sourcesAvailable,
    signals: report.signals.slice(0, 8).map((signal) => ({ title: signal.title, source: signal.source, link: signal.link, urgency: signal.urgency, direction: signal.direction, impactScore: signal.impactScore, publishedAt: signal.publishedAt })),
  }, { headers: { "Cache-Control": `public, max-age=${NEWS_BRIEF_TTL_SECONDS}` } });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function cachedJson(request: Request, ctx: ExecutionContext, path: string, ttlSeconds: number, build: () => Promise<unknown>): Promise<Response> {
  const cacheKey = new Request(new URL(path, request.url).toString());
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const response = Response.json(await build(), { headers: { "Cache-Control": `public, max-age=${ttlSeconds}` } });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/** Construye el radar y guarda una muestra tono+precio para el verificador de aciertos. */
async function radarWithSnapshot(env: Env, ctx: ExecutionContext): Promise<unknown> {
  const report = await fetchWorldRadar();
  ctx.waitUntil((async () => {
    const tickers = await fetchVenueTickers(env, TRACKED.map((entry) => entry.pair));
    const snapshot: RadarSnapshot = { at: report.generatedAt, topics: {} };
    for (const { topic, pair } of TRACKED) {
      const pulse = report.pulses.find((item) => item.topic === topic);
      const quote = findTicker(tickers, pair);
      if (pulse && quote && quote.bid > 0 && quote.ask > 0) snapshot.topics[topic] = { tone: pulse.tone, mentions: pulse.mentions, priceEur: (quote.bid + quote.ask) / 2 };
    }
    await botState(env).fetch("https://bot/radar-track/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
  })().catch((error) => console.error("RADAR_SNAPSHOT_FAILURE", error)));
  return report;
}

async function radarTrackResponse(env: Env): Promise<Response> {
  const response = await botState(env).fetch("https://bot/radar-track/state");
  const state = parseRadarTrack(response.ok ? await response.json<unknown>() : null);
  return Response.json(evaluateRadarTrack(state, Date.now()), { headers: { "Cache-Control": "no-store" } });
}

function shouldRunBaseStrategy(controller: ScheduledController): boolean { return new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0; }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const runtimeEnv = paperRuntimeEnv(env);
    if ((request.method === "GET" || request.method === "POST") && path === "/api/pilot/authorize-trade") return tradeApprovalResponse(request, runtimeEnv);
    if (request.method === "GET" && path === "/api/paper/economics") return paperEconomicsResponse(request, runtimeEnv, ctx);
    if (request.method === "GET" && path === "/api/xau/status") return botState(runtimeEnv).fetch("https://bot/xau/status");
    if (request.method === "GET" && path === "/api/xau/readiness") return xauReadinessResponse(runtimeEnv);
    if (request.method === "GET" && path === "/api/kraken/gold-readiness") return krakenGoldReadinessResponse(request, runtimeEnv, ctx, worker);
    if (request.method === "POST" && path === "/api/xau/cycle") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      return botState(runtimeEnv).fetch("https://bot/xau/cycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() });
    }
    if (request.method === "GET") { const install = appInstallResponse(path); if (install) return install; }
    if (request.method === "GET" && path === "/") return homeOrderScreen();
    if (request.method === "GET" && path === "/api/order-now") return orderNowResponse(runtimeEnv);
    if (request.method === "GET" && path === "/radar") return radarScreen();
    if (request.method === "GET" && path === "/api/radar") return cachedJson(request, ctx, "/api/radar", 180, () => radarWithSnapshot(runtimeEnv, ctx));
    if (request.method === "GET" && path === "/api/radar/track-record") return radarTrackResponse(runtimeEnv);
    if (request.method === "GET" && path === "/api/world-markets") return cachedJson(request, ctx, "/api/world-markets", 60, () => fetchWorldBoard());
    if (request.method === "GET" && path === "/api/news-brief") return newsBriefResponse(request, ctx);
    if (request.method === "GET" && path === "/api/signals/status") return signalStatusResponse(runtimeEnv);
    if (request.method === "POST" && path === "/api/signals/run") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      return Response.json(await runSignalAlerts(runtimeEnv), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && path === "/api/signals/test") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      const sent = await sendTelegramText(runtimeEnv, "✅ PRUEBA · Auto Bolsa\n\nLas alertas funcionan. Solo recibirás dos tipos de mensaje:\n🟢 COMPRA AHORA\n🔴 VENDE AHORA\n\nEsto es una prueba: no hagas nada.");
      return Response.json(sent, { status: sent.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && path === "/api/signals/reset-holding") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      const key = new URL(request.url).searchParams.get("key") ?? "";
      return botState(runtimeEnv).fetch("https://bot/signal-alerts/reset-holding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    }
    if (request.method === "POST" && path === "/api/pilot/auto-cycle") {
      if (!authorized(request, runtimeEnv)) return new Response("Unauthorized", { status: 401 });
      const result = await runXauPaxgLiveCycle(runtimeEnv);
      return Response.json(result, { status: "action" in result && result.action === "blocked" ? 409 : 200, headers: { "Cache-Control": "no-store" } });
    }
    return worker.fetch(request, paperRuntimeEnv(env), ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const runtimeEnv = paperRuntimeEnv(env);
    if (shouldRunBaseStrategy(controller)) {
      try { await worker.scheduled(controller, runtimeEnv, ctx); } catch (error) { console.error("BASE_STRATEGY_SCHEDULED_FAILURE", error); }
    }
    try { await runXauDecisionCycle(runtimeEnv); } catch (error) { console.error("XAU_DECISION_SCHEDULED_FAILURE", error); }
    try { await runXauPaxgLiveCycle(runtimeEnv); } catch (error) { console.error("XAU_PAXG_SCHEDULED_FAILURE", error); }
    ctx.waitUntil(runXauFastMonitoringSamples(runtimeEnv));
  },
};
