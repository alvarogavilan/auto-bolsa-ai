import type { LiveExecutorSnapshot, LiveOrder } from "./live-executor";
import { fetchLivePairResolution } from "./live-pair-metadata";
import type { PaperReadiness } from "./paper-readiness";
import {
  BOT_STATE_SINGLETON_NAME,
  LIVE_EXECUTOR_SINGLETON_NAME,
  type Env,
} from "./types";
import { calculateXauMicroLiveReadiness } from "./xau-live-readiness";

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
  const pair = env.PAIR || "XBTEUR";
  const executor = liveExecutorState(env);
  const [paperResponse, xauResponse, labResponse, liveResponse, detailsResponse, kraken, pairResolution] = await Promise.all([
    botState(env).fetch("https://bot/readiness"),
    botState(env).fetch("https://bot/xau/status"),
    researchLabState(env).fetch("https://lab/status"),
    executor.fetch("https://live/status"),
    executor.fetch("https://live/readiness-details"),
    krakenSafetySummary(env, forceKrakenRefresh),
    fetchLivePairResolution(pair).catch(() => null),
  ]);

  const paper = await paperResponse.json<PaperReadiness>();
  const xauStatus = xauResponse.ok ? await xauResponse.json<unknown>() : null;
  const xauMicroLive = xauStatus
    ? calculateXauMicroLiveReadiness(xauStatus)
    : {
        schemaVersion: "xau-micro-live-readiness-v1" as const,
        eligible: false,
        fullScaleEligible: false as const,
        pilotMaximumOrderNotionalEur: 5 as const,
        blockers: [`No se pudo leer la evidencia XAU (HTTP ${xauResponse.status})`],
      };
  const lab = await responseJson(labResponse);
  const live = await liveResponse.json<LiveExecutorSnapshot>();
  const details = await responseJson(detailsResponse);
  const demo = demoSummary(lab);
  const order = latestRelevantOrder(live);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const passedChecks: string[] = [];

  if (xauMicroLive.eligible) {
    passedChecks.push("La evidencia XAU cumple el gate del piloto micro-LIVE de hasta 5 €");
  } else {
    blockers.push(...xauMicroLive.blockers.map((value) => `XAU micro-LIVE: ${value}`));
  }

  if (paper.eligibleForLiveReview) {
    passedChecks.push("La evidencia PAPER general permite también revisión para escalado completo");
  } else {
    warnings.push("El gate PAPER general todavía bloquea el escalado de capital; no bloquea el piloto XAU limitado a 5 €");
  }

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

  if (pairResolution) passedChecks.push(`Metadatos públicos Kraken verificados para ${pair}`);
  else blockers.push(`No se pudieron verificar los metadatos públicos de ${pair}`);

  if (live.emergencyStopActive) blockers.push("La parada de emergencia del ejecutor está activa");
  else passedChecks.push("Sin parada de emergencia activa");

  if (live.emergencyStopRequiresManualLiquidation) blockers.push("Existe liquidación manual pendiente");
  if (live.lastBalanceCheckStatus === "consistent") passedChecks.push("Último balance LIVE reconciliado como consistente");
  else blockers.push("El balance LIVE todavía no tiene una reconciliación consistente");

  if (order?.status === "prepared") passedChecks.push("Existe una orden preparada para validate=true");
  else blockers.push("No existe una orden preparada para el preflight validate=true");

  const certificate = details.preflightCertificate as Record<string, unknown> | undefined;
  if (certificate?.status === "valid") passedChecks.push("Certificado validate=true vigente");
  else if (certificate?.status === "expired") warnings.push("El certificado validate=true ha caducado y deberá renovarse antes de cualquier ejecución");
  else if (certificate?.status === "invalid") blockers.push("El certificado validate=true es inválido");
  else warnings.push("No hay certificado validate=true vigente; se generará únicamente en el preflight previo a una ejecución autorizada");

  if (env.LIVE_TRADING_ENABLED === "true") {
    warnings.push("LIVE_TRADING_ENABLED aparece activo");
  } else {
    passedChecks.push("El interruptor LIVE permanece apagado hasta activación explícita del propietario");
  }

  const infrastructureEligibleForManualReview = blockers.length === 0;

  return {
    schemaVersion: "pilot-runtime-readiness-v3",
    generatedAt: Date.now(),
    liveTrading: env.LIVE_TRADING_ENABLED === "true" && env.TRADING_MODE === "live",
    executorBound: true,
    submissionArmed: false,
    submissionEndpointAvailable: false,
    maximumOrderNotionalEur: 5,
    eligibleForManualPilotReview: infrastructureEligibleForManualReview && xauMicroLive.eligible,
    microLivePilotEligible: xauMicroLive.eligible,
    fullScalePaperEligible: paper.eligibleForLiveReview,
    xauMicroLive,
    paper,
    demo,
    kraken,
    market: pairResolution
      ? {
          pair,
          canonicalPair: pairResolution.canonicalPair,
          acceptedPairCodes: pairResolution.acceptedPairCodes,
          orderMinBase: pairResolution.metadata.orderMinBase,
          lotDecimals: pairResolution.metadata.lotDecimals,
          priceDecimals: pairResolution.metadata.priceDecimals,
          checkedAt: Date.now(),
        }
      : { pair, available: false },
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
    preflightCertificate: details.preflightCertificate ?? { status: "absent" },
    submissionJournal: details.submissionJournal ?? { phase: "none" },
    reconciliation: details.reconciliation ?? {
      everRun: live.lastBalanceCheckStatus !== null,
      ok: live.lastBalanceCheckStatus === "consistent",
      balanceStatus: live.lastBalanceCheckStatus,
      unresolvedOrderCount: 0,
    },
    blockers,
    warnings,
    passedChecks,
    infrastructureEligibleForManualReview,
    message: infrastructureEligibleForManualReview && xauMicroLive.eligible
      ? "Piloto XAU micro-LIVE técnicamente elegible para revisión manual, limitado a 5 €. LIVE permanece apagado."
      : `Piloto XAU todavía bloqueado por ${blockers.length} condición(es).`,
  };
}
