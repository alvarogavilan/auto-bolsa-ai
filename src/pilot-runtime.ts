import type { KrakenEffectiveFeesAudit } from "./kraken-fees";
import type { LiveExecutorSnapshot, LiveOrder } from "./live-executor";
import { fetchLivePairResolution } from "./live-pair-metadata";
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

export interface KrakenEffectiveFeeSummary {
  available: boolean;
  checkedAt: number | null;
  pairRequested: string | null;
  pairResolved: string | null;
  currency: string | null;
  volume30d: number | null;
  tierBasis: number | null;
  tierBasisSource: string | null;
  makerFeePercent: number | null;
  makerFeeRate: number | null;
  takerFeePercent: number | null;
  takerFeeRate: number | null;
  assumedPaperFeeEachSidePercent: number | null;
  paperFeeMatchesCurrentTaker: boolean | null;
  paperTakerGapRate: number | null;
  fiveEurTakerRoundTripFeeEur: number | null;
  error: string | null;
  permissionRequired: "query-funds";
  readOnly: true;
  changesStrategyParameters: false;
  realOrderCreated: false;
  liveTrading: false;
}

interface KrakenSafetySummary {
  connection: KrakenConnectionSummary;
  permissions: KrakenPermissionSummary;
  fees: KrakenEffectiveFeeSummary;
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
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function bool(value: unknown): boolean {
  return value === true;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function summarizeKrakenEffectiveFees(connectionBody: Record<string, unknown>): KrakenEffectiveFeeSummary {
  const audit = objectOrNull(connectionBody.effectiveFees) as (Record<string, unknown> & Partial<KrakenEffectiveFeesAudit>) | null;
  const status = objectOrNull(connectionBody.effectiveFeesStatus);
  const maker = objectOrNull(audit?.maker);
  const taker = objectOrNull(audit?.taker);
  const tierInputs = objectOrNull(audit?.tierInputs);
  const validAudit = audit?.schemaVersion === "kraken-effective-fees-v1";
  const available = validAudit && status?.available !== false;

  return {
    available,
    checkedAt: available ? finiteOrNull(audit?.checkedAt) : null,
    pairRequested: available && typeof audit?.pairRequested === "string" ? audit.pairRequested : null,
    pairResolved: available && typeof audit?.pairResolved === "string" ? audit.pairResolved : null,
    currency: available && typeof audit?.currency === "string" ? audit.currency : null,
    volume30d: available ? finiteOrNull(audit?.volume30d) : null,
    tierBasis: available ? finiteOrNull(tierInputs?.effectiveTierBasis) : null,
    tierBasisSource: available && typeof tierInputs?.effectiveTierBasisSource === "string"
      ? tierInputs.effectiveTierBasisSource
      : null,
    makerFeePercent: available ? finiteOrNull(maker?.percent) : null,
    makerFeeRate: available ? finiteOrNull(maker?.rate) : null,
    takerFeePercent: available ? finiteOrNull(taker?.percent) : null,
    takerFeeRate: available ? finiteOrNull(taker?.rate) : null,
    assumedPaperFeeEachSidePercent: available
      ? finiteOrNull(audit?.assumedPaperFeeEachSidePct)
      : null,
    paperFeeMatchesCurrentTaker: available
      ? nullableBoolean(audit?.paperFeeMatchesCurrentTaker)
      : null,
    paperTakerGapRate: available ? finiteOrNull(audit?.paperTakerGapRate) : null,
    fiveEurTakerRoundTripFeeEur: available
      ? finiteOrNull(audit?.fiveEurTakerRoundTripFeeEur)
      : null,
    error: errorOrNull(status?.error),
    permissionRequired: "query-funds",
    readOnly: true,
    changesStrategyParameters: false,
    realOrderCreated: false,
    liveTrading: false,
  };
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
    fees: summarizeKrakenEffectiveFees(connectionBody),
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

function percentText(value: number | null): string {
  return value === null ? "desconocida" : `${value.toFixed(4)} %`;
}

export async function buildPilotRuntimeReadiness(
  env: Env,
  forceKrakenRefresh = false,
): Promise<Record<string, unknown>> {
  const pair = env.PAIR || "XBTEUR";
  const executor = liveExecutorState(env);
  const [paperResponse, labResponse, liveResponse, detailsResponse, kraken, pairResolution] = await Promise.all([
    botState(env).fetch("https://bot/readiness"),
    researchLabState(env).fetch("https://lab/status"),
    executor.fetch("https://live/status"),
    executor.fetch("https://live/readiness-details"),
    krakenSafetySummary(env, forceKrakenRefresh),
    fetchLivePairResolution(pair).catch(() => null),
  ]);

  const paper = await paperResponse.json<PaperReadiness>();
  const lab = await responseJson(labResponse);
  const live = await liveResponse.json<LiveExecutorSnapshot>();
  const details = await responseJson(detailsResponse);
  const demo = demoSummary(lab);
  const order = latestRelevantOrder(live);
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

  if (kraken.fees.available) {
    passedChecks.push(
      `Tarifa efectiva Kraken leída en modo consulta: maker ${percentText(kraken.fees.makerFeePercent)}, taker ${percentText(kraken.fees.takerFeePercent)}`,
    );
    if (kraken.fees.paperFeeMatchesCurrentTaker === false) {
      warnings.push(
        `La tarifa taker efectiva (${percentText(kraken.fees.takerFeePercent)}) difiere del supuesto PAPER (${percentText(kraken.fees.assumedPaperFeeEachSidePercent)}). La cohorte congelada no se modifica automáticamente.`,
      );
    }
  } else {
    warnings.push(
      `No se pudo leer la tarifa efectiva Kraken en esta comprobación${kraken.fees.error ? `: ${kraken.fees.error}` : "."}`,
    );
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
  else if (certificate?.status === "expired") warnings.push("El certificado validate=true ha caducado");
  else if (certificate?.status === "invalid") blockers.push("El certificado validate=true es inválido");

  if (env.LIVE_TRADING_ENABLED === "true") {
    warnings.push("LIVE_TRADING_ENABLED aparece activo, pero la ruta pública de envío sigue bloqueada");
  } else {
    passedChecks.push("El interruptor LIVE permanece apagado");
  }

  return {
    schemaVersion: "pilot-runtime-readiness-v2",
    generatedAt: Date.now(),
    liveTrading: false,
    executorBound: true,
    submissionArmed: false,
    submissionEndpointAvailable: false,
    maximumOrderNotionalEur: 5,
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
    infrastructureEligibleForManualReview: blockers.length === 0,
    message: blockers.length === 0
      ? "Infraestructura elegible para revisión humana. El envío real continúa sin ruta y sin activación."
      : `Piloto todavía bloqueado por ${blockers.length} condición(es).`,
  };
}
