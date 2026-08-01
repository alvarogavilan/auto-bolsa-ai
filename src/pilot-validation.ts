import type { LiveOrder, LiveOrderRequest } from "./live-executor";
import { fetchAllTickers, fetchTradableAssetPairs, type KrakenAssetPair, type KrakenTicker } from "./kraken-markets";
import { resolveLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import { buildValidateOnlyBuyPlan, DEFAULT_PREFLIGHT_NOTIONAL_EUR } from "./live-preflight-plan";
import {
  checkLivePreflightCertificate,
  type LivePreflightCertificate,
} from "./live-preflight-certificate";
import { krakenSafetySummary } from "./pilot-runtime";
import type { Env } from "./types";

/**
 * Mismo margen conservador de comisión usado en el resto del sistema PAPER
 * (`bot-state.ts`, `execution-quality.ts`, `research-lab.ts`: 0,004 = 0,40 %
 * taker). No se cobra ninguna comisión real aquí: solo se resta del
 * presupuesto para que `volumeBase × limitPrice` deje margen y nunca quede al
 * límite exacto del máximo estructural.
 */
const FEE_MARGIN_PCT = 0.004;

/**
 * Máximo spread tolerado, igual al límite más laxo ya aceptado en
 * `market-universe.ts` (lane "swing"). Un piloto real no debe ser más
 * permisivo que lo que el propio sistema PAPER ya considera el peor caso
 * aceptable.
 */
const MAX_SPREAD_PCT = 0.01;

export interface PilotValidationProposal {
  pair: string;
  resolution: LivePairResolution;
  side: "buy";
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
  idempotencyKey: string;
  askPrice: number;
  bidPrice: number;
  spreadPct: number;
  eurBalance: number;
  checkedAt: number;
}

export type BuildPilotValidationProposalResult =
  | { ok: true; proposal: PilotValidationProposal }
  | { ok: false; blockers: string[] };

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Todo lo que `computePilotValidationProposal` necesita, ya resuelto por el
 * llamador. Ninguno de estos campos procede del navegador: `pair` viene de
 * `env.PAIR`, y el resto de respuestas públicas/auditadas de Kraken.
 */
export interface PilotValidationComputationInputs {
  pair: string;
  krakenConnected: boolean;
  krakenPermissionsSafe: boolean;
  eurBalance: number | null;
  assetPairs: readonly KrakenAssetPair[];
  tickers: Readonly<Record<string, KrakenTicker>>;
  /** Fábrica del idempotencyKey, sustituible en pruebas para un resultado determinista. */
  idempotencyKeyFactory?: () => string;
}

/**
 * Núcleo puro y determinista (sin `env`, sin `fetch`, sin caché): dado el
 * estado de Kraken ya consultado, calcula la propuesta de compra límite
 * exclusivamente para validación (`validate=true`) de hasta
 * `min(5 €, 50 % del saldo EUR real)`, dejando margen para comisiones.
 */
export function computePilotValidationProposal(
  inputs: PilotValidationComputationInputs,
  now = Date.now(),
): BuildPilotValidationProposalResult {
  const blockers: string[] = [];
  if (!inputs.krakenConnected) {
    blockers.push("Kraken no está conectado o el saldo no se pudo confirmar de forma reciente");
  }
  if (!inputs.krakenPermissionsSafe) {
    blockers.push("Los permisos de la API key no están auditados como completos y seguros");
  }
  if (inputs.eurBalance === null || !positiveFinite(inputs.eurBalance)) {
    blockers.push("No hay un saldo EUR real y positivo confirmado por Kraken");
  }
  if (blockers.length > 0) return { ok: false, blockers };
  // Validado justo arriba: si hubiera sido null o no positivo, ya se habría
  // devuelto con blockers. A partir de aquí es un número positivo real.
  const eurBalance = inputs.eurBalance as number;

  let resolution: LivePairResolution;
  try {
    resolution = resolveLivePairResolution(inputs.assetPairs, inputs.pair);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo resolver el par configurado";
    return { ok: false, blockers: [message] };
  }
  const assetPair = inputs.assetPairs.find((candidate) => candidate.key === resolution.canonicalPair);
  const costMinQuote = assetPair?.costmin ?? 0;

  const ticker = resolution.acceptedPairCodes
    .map((code) => inputs.tickers[code])
    .find((candidate) => candidate !== undefined) ?? inputs.tickers[resolution.canonicalPair];
  if (!ticker || !positiveFinite(ticker.ask) || !positiveFinite(ticker.bid)) {
    return { ok: false, blockers: [`No hay un ticker público válido de Kraken para ${resolution.canonicalPair}`] };
  }
  const askPrice = ticker.ask;
  const bidPrice = ticker.bid;

  const midPrice = (askPrice + bidPrice) / 2;
  const spreadPct = midPrice > 0 ? Math.max(0, (askPrice - bidPrice) / midPrice) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(spreadPct)) return { ok: false, blockers: ["Spread inválido en el ticker público"] };
  if (spreadPct > MAX_SPREAD_PCT) {
    return {
      ok: false,
      blockers: [`El spread actual (${(spreadPct * 100).toFixed(3)}%) supera el máximo permitido (${(MAX_SPREAD_PCT * 100).toFixed(2)}%)`],
    };
  }

  const rawBudget = Math.min(DEFAULT_PREFLIGHT_NOTIONAL_EUR, eurBalance * 0.5);
  const budgetWithFeeMargin = rawBudget * (1 - FEE_MARGIN_PCT);
  if (!positiveFinite(budgetWithFeeMargin)) {
    return { ok: false, blockers: ["El presupuesto disponible tras el margen de comisión no es positivo"] };
  }

  let plan;
  try {
    plan = buildValidateOnlyBuyPlan({
      pair: resolution.canonicalPair,
      askPrice,
      metadata: resolution.metadata,
      costMinQuote,
      requestedNotionalEur: budgetWithFeeMargin,
      maxNotionalEur: rawBudget,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo construir la propuesta de validación";
    return { ok: false, blockers: [message] };
  }

  return {
    ok: true,
    proposal: {
      pair: resolution.canonicalPair,
      resolution,
      side: "buy",
      volumeBase: plan.intent.volumeBase,
      limitPrice: plan.intent.limitPrice,
      notionalEur: plan.intent.notionalEur,
      idempotencyKey: (inputs.idempotencyKeyFactory ?? (() => crypto.randomUUID()))(),
      askPrice,
      bidPrice,
      spreadPct,
      eurBalance,
      checkedAt: now,
    },
  };
}

/**
 * Envoltorio async: consulta `env.PAIR`, el estado de Kraken ya auditado
 * (`krakenSafetySummary`, forzando refresco) y los datos públicos frescos de
 * mercado, y delega todo el cálculo determinista en
 * `computePilotValidationProposal`. No acepta par, volumen, precio, saldo ni
 * importe del navegador: la única entrada es `env`.
 */
export async function buildPilotValidationProposal(env: Env): Promise<BuildPilotValidationProposalResult> {
  const pair = env.PAIR || "XBTEUR";

  const kraken = await krakenSafetySummary(env, true);
  const krakenConnected = kraken.connection.connected;
  const krakenPermissionsSafe = kraken.permissions.auditComplete && kraken.permissions.safePermissions;
  const eurBalance = kraken.connection.eurBalance;

  // Solo se consultan los datos públicos de mercado si Kraken ya está
  // conectado y auditado como seguro: evita una llamada pública innecesaria
  // cuando la propuesta va a bloquearse igualmente por esa razón.
  if (!krakenConnected || !krakenPermissionsSafe || eurBalance === null) {
    return computePilotValidationProposal({
      pair,
      krakenConnected,
      krakenPermissionsSafe,
      eurBalance,
      assetPairs: [],
      tickers: {},
    });
  }

  try {
    const [assetPairs, tickers] = await Promise.all([fetchTradableAssetPairs(), fetchAllTickers()]);
    return computePilotValidationProposal({
      pair,
      krakenConnected,
      krakenPermissionsSafe,
      eurBalance,
      assetPairs,
      tickers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron obtener datos públicos de Kraken";
    return { ok: false, blockers: [message] };
  }
}

export function pilotValidationProposalToOrderRequest(proposal: PilotValidationProposal): LiveOrderRequest {
  return {
    idempotencyKey: proposal.idempotencyKey,
    pair: proposal.pair,
    side: proposal.side,
    volumeBase: proposal.volumeBase,
    limitPrice: proposal.limitPrice,
    notionalEur: proposal.notionalEur,
  };
}

export type PreflightCertificateDisplayStatus = "absent" | "valid" | "expired" | "consumed" | "invalid";

/**
 * Traduce el certificado almacenado (si existe) a un estado sanitizado para
 * mostrar en el informe de preparación. Reutiliza la verificación exacta
 * (`checkLivePreflightCertificate`) en vez de adivinar por texto, así que
 * también detecta de forma fiable un certificado corrupto o que ya no
 * coincide con la orden preparada actual.
 */
export async function preflightCertificateDisplayStatus(
  certificate: LivePreflightCertificate | null,
  order: LiveOrder | null,
  now = Date.now(),
): Promise<PreflightCertificateDisplayStatus> {
  if (!certificate || !order) return "absent";
  if (certificate.consumedAt !== null) return "consumed";

  const check = await checkLivePreflightCertificate(certificate, order.clOrdId, order.request, now);
  if (check.allowed) return "valid";
  if (now >= certificate.expiresAt) return "expired";
  return "invalid";
}
