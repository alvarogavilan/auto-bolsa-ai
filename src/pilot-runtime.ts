import type { LiveExecutorSnapshot, LiveOrder } from "./live-executor";
import type { PaperReadiness } from "./paper-readiness";
import {
  BOT_STATE_SINGLETON_NAME,
  LIVE_EXECUTOR_SINGLETON_NAME,
  type Env,
} from "./types";

const KRAKEN_SAFETY_CACHE_TTL_SECONDS = 10 * 60;

interface KrakenConnectionSummary {
  checkedAt: number;
  configured: boolean;
  connected: boolean;
  eurBalance: number | null;
  nonZeroAssetCount: number | null;
  error: string | null;
}

interface KrakenPermissionSummary {
  checkedAt: number;
  auditComplete: boolean;
  safePermissions: boolean;
  withdrawalPermission: boolean | null;
  depositPermission: boolean | null;
  earnPermission: boolean | null;
  error: string | null;
}

interface KrakenSafetySummary {
  connection: KrakenConnectionSummary;
  permissions: KrakenPermissionSummary;
}

interface DemoStatusSummary {
  status: string;
  message: string | null;
  updatedAt: number | null;
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function researchLabState(env: Env): DurableObjectStub {
  return env.RESEARCH_LAB.get(env.RESEARCH_LAB.idFromName("auto-bolsa-ai-research-lab"));
}

export function liveExecutorState(env: Env): DurableObjectStub {
  return env.LIVE_EXECUTOR.get(env.LIVE_EXECUTOR.idFromName(LIVE_EXECUTOR_SINGLETON_NAME));
}

function safetyCacheKey(): Request {
  return new Request("https://cache.auto-bolsa-ai.internal/pilot-kraken-safety-v1");
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function bool(value: unknown): boolean {
  return value === true;
}

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function queryKrakenSafety(env: Env): Promise<KrakenSafetySummary> {
  const stub = botState(env);
  const connectionResponse = await stub.fetch("https://bot/kraken/connection");
  const connectionBody = await responseJson(connectionResponse);

  // Secuencial a propósito: ambas peticiones privadas comparten la única
  // autoridad persistente de nonce en BotState.
  const permissionsResponse = await stub.fetch("https://bot/kraken/permissions");
  const permissionsBody = await responseJson(permissionsResponse);
  const now = Date.now();

  return {
    connection: {
      checkedAt: now,
      configured: bool(connectionBody.configured),
      connected: connectionResponse.ok && bool(connectionBody.connected),
      eurBalance: finiteOrNull(connectionBody.eurBalance),
      nonZeroAssetCount: finiteOrNull(connectionBody.nonZeroAssetCount),
      error: errorOrNull(connectionBody.error) ?? (connectionResponse.ok ? null : `HTTP ${connectionResponse.status}`),
    },
    permissions: {
      checkedAt: now,
      auditComplete: permissionsResponse.ok && bool(permissionsBody.auditComplete),
      safePermissions: permissionsResponse.ok && bool(permissionsBody.safePermissions),
      withdrawalPermission: typeof permissionsBody.withdrawalPermission === "boolean"
        ? permissionsBody.withdrawalPermission
        : null,
      depositPermission: typeof permissionsBody.depositPermission === "boolean"
        ? permissionsBody.depositPermission
        : null,
      earnPermission: typeof permissionsBody.earnPermission === "boolean"
        ? permissionsBody.earnPermission
        : null,
      error: errorOrNull(permissionsBody.error) ?? (permissionsResponse.ok ? null : `HTTP ${permissionsResponse.status}`),
    },
  };
}

export async function krakenSafetySummary(env: Env, forceRefresh = false): Promise<KrakenSafetySummary> {
  const cache = caches.default;
  const key = safetyCacheKey();
  if (!forceRefresh) {
    const cached = await cache.match(key);
    if (cached) return cached.json<KrakenSafetySummary>();
  }

  const summary = await queryKrakenSafety(env);
  await cache.put(
    key,
    Response.json(summary, {
      headers: { "Cache-Control": `private, max-age=${KRAKEN_SAFETY_CACHE_TTL_SECONDS}` },
    }),
  );
  return summary;
}

function latestRelevantOrder(state: LiveExecutorSnapshot): LiveOrder | null {
  if (state.activeClOrdId && state.orders[state.activeClOrdId]) return state.orders[state.activeClOrdId] ?? null;
  return Object.values(state.orders).sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

/** Forma extendida de `/status`: el snapshot más certificado/journal/mercado ya sanitizados por `LiveExecutorState`. */
interface LiveExecutorStatusResponse extends LiveExecutorSnapshot {
  certificateStatus?: string;
  journal?: { phase: string };
  pairMetadata?: {
    pair: string;
    orderMinBase: number;
    lotDecimals: number;
    priceDecimals: number;
    checkedAt: number;
  } | null;
}

function demoSummary(value: unknown): DemoStatusSummary {
  if (!value || typeof value !== "object") return { status: "unknown", message: null, updatedAt: null };
  const body = value as { shadowLiveDemo?: unknown };
  if (!body.shadowLiveDemo || typeof body.shadowLiveDemo !== "object") {
    return { status: "unknown", message: null, updatedAt: null };
  }
  const demo = body.shadowLiveDemo as Record<string, unknown>;
  return {
    status: typeof demo.status === "string" ? demo.status : "unknown",
    message: typeof demo.message === "string" ? demo.message : null,
    updatedAt: finiteOrNull(demo.updatedAt),
  };
}

function safeOrder(order: LiveOrder | null): Record<string, unknown> | null {
  if (!order) return null;
  return {
    clOrdId: order.clOrdId,
    status: order.status,
    pair: order.request.pair,
    side: order.request.side,
    volumeBase: order.request.volumeBase,
    limitPrice: order.request.limitPrice,
    notionalEur: order.request.notionalEur,
    filledVolumeBase: order.filledVolumeBase,
    averageFillPrice: order.averageFillPrice,
    attempts: order.attempts,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function buildPilotRuntimeReadiness(
  env: Env,
  forceKrakenRefresh = false,
): Promise<Record<string, unknown>> {
  const [paperResponse, labResponse, liveResponse, kraken] = await Promise.all([
    botState(env).fetch("https://bot/readiness"),
    researchLabState(env).fetch("https://lab/status"),
    liveExecutorState(env).fetch("https://live/status"),
    krakenSafetySummary(env, forceKrakenRefresh),
  ]);

  const paper = await paperResponse.json<PaperReadiness>();
  const lab = await responseJson(labResponse);
  const live = await liveResponse.json<LiveExecutorStatusResponse>();
  const demo = demoSummary(lab);
  const order = latestRelevantOrder(live);
  const certificateStatus = live.certificateStatus ?? "absent";
  const journalPhase = live.journal?.phase ?? "none";
  const blockers: string[] = [];
  const warnings: string[] = [];
  const passedChecks: string[] = [];

  if (paper.eligibleForLiveReview) passedChecks.push("La evidencia PAPER cumple los mínimos para revisión humana");
  else blockers.push("La evidencia PAPER todavía no cumple todos los mínimos definidos");

  if (demo.status === "error") blockers.push("El DEMO está en estado de error");
  else if (demo.status === "safety_halt") warnings.push("El DEMO está detenido por una protección de seguridad");
  else passedChecks.push(`DEMO operativo: ${demo.status}`);

  if (kraken.connection.connected) passedChecks.push("Kraken autenticado y saldo consultable");
  else blockers.push("Kraken no está autenticado o la comprobación no es reciente");

  if (kraken.permissions.auditComplete && kraken.permissions.safePermissions) {
    passedChecks.push("Permisos Kraken auditados sin retirada, depósito ni Earn");
  } else {
    blockers.push("La auditoría de permisos Kraken no está completa o no es segura");
  }

  if (live.emergencyStopActive) blockers.push("La parada de emergencia del ejecutor está activa");
  else passedChecks.push("Sin parada de emergencia activa");

  if (live.emergencyStopRequiresManualLiquidation) blockers.push("Existe liquidación manual pendiente");
  if (live.lastBalanceCheckStatus === "consistent") passedChecks.push("Último balance LIVE reconciliado como consistente");
  else blockers.push("El balance LIVE todavía no tiene una reconciliación consistente");

  if (order?.status === "prepared") passedChecks.push("Existe una orden preparada para validate=true");
  else blockers.push("No existe una orden preparada para el preflight validate=true");

  // Informativo: certificado y journal documentan en qué punto del flujo
  // validate-only está la orden preparada actual, pero no gatean por sí
  // mismos `infrastructureEligibleForManualReview` — esa elegibilidad ya
  // depende de que exista una orden `prepared`, y el paso de preflight es
  // una acción manual explícita posterior desde la app.
  if (certificateStatus === "valid") passedChecks.push("El certificado de preflight validate=true está vigente");
  else if (certificateStatus === "consumed") passedChecks.push("El certificado de preflight ya fue consumido en un ciclo anterior");
  else if (certificateStatus === "expired") warnings.push("El certificado de preflight ha caducado; repite el preflight para renovarlo");
  else if (certificateStatus === "invalid") warnings.push("El certificado de preflight almacenado no supera la verificación exacta");

  if (journalPhase === "reconciled") passedChecks.push("El journal de envío de la orden más reciente está reconciliado");
  else if (journalPhase !== "none") warnings.push(`El journal de envío está en fase "${journalPhase}", pendiente de reconciliar`);

  if (env.LIVE_TRADING_ENABLED === "true") {
    warnings.push("LIVE_TRADING_ENABLED aparece activo, pero la ruta pública de envío sigue bloqueada");
  } else {
    passedChecks.push("El interruptor LIVE permanece apagado");
  }

  return {
    schemaVersion: "pilot-runtime-readiness-v1",
    generatedAt: Date.now(),
    liveTrading: false,
    executorBound: true,
    submissionArmed: false,
    submissionEndpointAvailable: false,
    maximumOrderNotionalEur: 5,
    paper,
    demo,
    kraken,
    market: live.pairMetadata ?? null,
    preflightCertificate: { status: certificateStatus },
    submissionJournal: { phase: journalPhase },
    executor: {
      createdAt: live.createdAt,
      updatedAt: live.updatedAt,
      activeClOrdId: live.activeClOrdId,
      orderCount: Object.keys(live.orders).length,
      order: safeOrder(order),
      inventory: live.inventory,
      lastMarketDataAt: live.lastMarketDataAt,
      lastBalanceCheckStatus: live.lastBalanceCheckStatus,
      emergencyStopActive: live.emergencyStopActive,
      emergencyStopRequiresManualLiquidation: live.emergencyStopRequiresManualLiquidation,
      consecutiveTransportErrors: live.consecutiveTransportErrors,
    },
    blockers,
    warnings,
    passedChecks,
    infrastructureEligibleForManualReview: blockers.length === 0,
    message: blockers.length === 0
      ? "Infraestructura elegible para revisión humana. El envío real continúa sin ruta y sin activación."
      : `Piloto todavía bloqueado por ${blockers.length} condición(es).`,
  };
}
