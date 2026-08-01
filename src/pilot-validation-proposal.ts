import { canonicalKrakenFeePair } from "./kraken-fees";
import { fetchAllTickers, type KrakenTicker } from "./kraken-markets";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import type { LiveOrderRequest } from "./live-executor";
import type { KrakenAccountCleanlinessAudit } from "./live-order-preflight";
import { auditPilotAccountCleanliness } from "./pilot-account-cleanliness";
import {
  fetchPilotValidationSafety,
  type PilotValidationSafety,
} from "./pilot-validation-safety";
import type { Env } from "./types";

const MIN_FEE_RESERVE_RATE = 0.01;
const FEE_RESERVE_BUFFER_RATE = 0.0025;
const MAX_EFFECTIVE_TAKER_RATE = 0.05;
const MAX_FEE_AUDIT_AGE_MS = 15 * 60_000;
const MAX_VALIDATION_NOTIONAL_EUR = 5;
const MAX_BALANCE_ALLOCATION_PCT = 0.5;
const MAX_VALIDATION_SPREAD_PCT = 0.01;

function normalizePair(value: string): string {
  return value.toUpperCase().replaceAll("/", "").replaceAll("-", "").trim();
}

function ceilToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - 1e-12) / factor;
}

function floorToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-12) / factor;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function findTicker(
  tickers: Record<string, KrakenTicker>,
  resolution: LivePairResolution,
): { key: string; ticker: KrakenTicker } | null {
  const accepted = new Set(
    [resolution.canonicalPair, resolution.requestedPair, ...resolution.acceptedPairCodes].map(normalizePair),
  );
  for (const [key, ticker] of Object.entries(tickers)) {
    if (accepted.has(normalizePair(key))) return { key, ticker };
  }
  return null;
}

function effectiveFeeReserve(
  safety: PilotValidationSafety,
  pair: string,
  now: number,
): {
  takerRate: number;
  reserveRate: number;
  checkedAt: number;
} {
  const audit = safety.connection.effectiveFees;
  if (!audit) {
    const reason = safety.connection.effectiveFeesError
      ? `: ${safety.connection.effectiveFeesError}`
      : "";
    throw new Error(`La tarifa efectiva de Kraken no está disponible${reason}`);
  }
  if (!Number.isFinite(audit.checkedAt) || audit.checkedAt <= 0) {
    throw new Error("La auditoría de tarifas Kraken no tiene una fecha válida");
  }
  if (audit.checkedAt > now + 60_000 || now - audit.checkedAt > MAX_FEE_AUDIT_AGE_MS) {
    throw new Error("La auditoría de tarifas Kraken está caducada");
  }
  if (canonicalKrakenFeePair(audit.pairRequested) !== canonicalKrakenFeePair(pair)) {
    throw new Error("La auditoría de tarifas no corresponde al par configurado");
  }
  const taker = audit.taker;
  if (!taker || canonicalKrakenFeePair(taker.pair) !== canonicalKrakenFeePair(pair)) {
    throw new Error("Kraken no devolvió una tarifa taker verificable para el par configurado");
  }
  if (!Number.isFinite(taker.rate) || taker.rate < 0 || taker.rate > MAX_EFFECTIVE_TAKER_RATE) {
    throw new Error("La tarifa taker efectiva está fuera del rango de seguridad");
  }
  const reserveRate = Math.max(MIN_FEE_RESERVE_RATE, taker.rate + FEE_RESERVE_BUFFER_RATE);
  if (!Number.isFinite(reserveRate) || reserveRate <= 0 || reserveRate >= 1) {
    throw new Error("La reserva de comisión calculada es inválida");
  }
  return { takerRate: taker.rate, reserveRate, checkedAt: audit.checkedAt };
}

export interface PilotValidationProposal {
  schemaVersion: "pilot-validation-proposal-v1";
  generatedAt: number;
  pair: string;
  canonicalPair: string;
  tickerKey: string;
  ask: number;
  bid: number;
  spreadPct: number;
  priceDecimals: number;
  lotDecimals: number;
  orderMinBase: number;
  eurBalance: number;
  grossBudgetEur: number;
  effectiveTakerFeeRate: number;
  feeReserveBufferRate: number;
  feeReservePct: number;
  feeAuditCheckedAt: number;
  request: LiveOrderRequest;
  validateOnly: true;
  realOrderCreated: false;
  liveTrading: false;
}

export interface PilotValidationProposalDependencies {
  safety: PilotValidationSafety;
  accountAudit: KrakenAccountCleanlinessAudit;
  resolution: LivePairResolution;
  tickers: Record<string, KrakenTicker>;
  pair: string;
  now: number;
  idempotencyKey: string;
}

/** Función pura y determinista para probar límites, cuantización, costes y aliases. */
export function buildPilotValidationProposal(
  dependencies: PilotValidationProposalDependencies,
): PilotValidationProposal {
  const { safety, accountAudit, resolution, tickers, pair, now, idempotencyKey } = dependencies;
  if (!safety.connection.connected) throw new Error("Kraken no está autenticado");
  if (!safety.permissions.auditComplete || !safety.permissions.safePermissions) {
    throw new Error("Los permisos Kraken no están auditados como seguros");
  }

  const eurBalance = accountAudit.eurBalance;
  if (!Number.isFinite(eurBalance) || (eurBalance ?? 0) <= 0) {
    throw new Error("Saldo EUR no disponible o no positivo");
  }
  if (accountAudit.nonEurAssetCount !== 0) {
    throw new Error("La cuenta Kraken contiene activos adicionales o inventario no conciliado");
  }
  if (!Number.isFinite(accountAudit.openOrderCount)) {
    throw new Error("No se pudo verificar si existen órdenes abiertas previas en Kraken");
  }
  if (accountAudit.openOrderCount !== 0) {
    throw new Error("La cuenta Kraken contiene órdenes abiertas previas");
  }
  if (accountAudit.accountCleanForBaseline !== true) {
    throw new Error(
      accountAudit.blockers.length > 0
        ? `La cuenta Kraken no está limpia: ${accountAudit.blockers.join("; ")}`
        : "La cuenta Kraken no está limpia para calibrar el piloto",
    );
  }
  if (!idempotencyKey.trim()) throw new Error("Falta idempotencyKey del servidor");

  const fee = effectiveFeeReserve(safety, pair, now);
  const match = findTicker(tickers, resolution);
  if (!match) throw new Error(`No existe ticker público reciente para ${pair}`);
  const { ticker } = match;
  if (!Number.isFinite(ticker.ask) || ticker.ask <= 0 || !Number.isFinite(ticker.bid) || ticker.bid <= 0) {
    throw new Error("Ticker público sin bid/ask válidos");
  }

  const middle = (ticker.ask + ticker.bid) / 2;
  const spreadPct = middle > 0 ? (ticker.ask - ticker.bid) / middle : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(spreadPct) || spreadPct < 0) throw new Error("Spread público inválido");
  if (spreadPct > MAX_VALIDATION_SPREAD_PCT) {
    throw new Error(`Spread público demasiado amplio para validar (${spreadPct})`);
  }

  const limitPrice = ceilToDecimals(ticker.ask, resolution.metadata.priceDecimals);
  const grossBudgetEur = Math.min(MAX_VALIDATION_NOTIONAL_EUR, (eurBalance as number) * MAX_BALANCE_ALLOCATION_PCT);
  const spendableEur = grossBudgetEur * (1 - fee.reserveRate);
  const volumeBase = floorToDecimals(spendableEur / limitPrice, resolution.metadata.lotDecimals);
  if (volumeBase < resolution.metadata.orderMinBase) {
    throw new Error(
      `El presupuesto seguro no alcanza el mínimo de Kraken (${resolution.metadata.orderMinBase})`,
    );
  }
  const notionalEur = money(volumeBase * limitPrice);
  if (notionalEur <= 0 || notionalEur > grossBudgetEur + 1e-9 || notionalEur > MAX_VALIDATION_NOTIONAL_EUR + 1e-9) {
    throw new Error("La propuesta excede el presupuesto validate-only");
  }

  return {
    schemaVersion: "pilot-validation-proposal-v1",
    generatedAt: now,
    pair,
    canonicalPair: resolution.canonicalPair,
    tickerKey: match.key,
    ask: ticker.ask,
    bid: ticker.bid,
    spreadPct,
    priceDecimals: resolution.metadata.priceDecimals,
    lotDecimals: resolution.metadata.lotDecimals,
    orderMinBase: resolution.metadata.orderMinBase,
    eurBalance: eurBalance as number,
    grossBudgetEur: money(grossBudgetEur),
    effectiveTakerFeeRate: fee.takerRate,
    feeReserveBufferRate: FEE_RESERVE_BUFFER_RATE,
    feeReservePct: fee.reserveRate,
    feeAuditCheckedAt: fee.checkedAt,
    request: {
      idempotencyKey,
      pair,
      side: "buy",
      volumeBase,
      limitPrice,
      notionalEur,
    },
    validateOnly: true,
    realOrderCreated: false,
    liveTrading: false,
  };
}

/** Construye la propuesta exclusivamente con cuenta privada y mercado público obtenidos por el servidor. */
export async function buildPilotValidationProposalFromKraken(
  env: Env,
  now = Date.now(),
): Promise<PilotValidationProposal> {
  const pair = env.PAIR || "XBTEUR";

  // Todas las lecturas privadas son secuenciales. La primera conexión obtiene
  // también la tarifa efectiva; después se auditan permisos y limpieza de
  // cuenta bajo la concesión global. Solo mercado público se paraleliza.
  const safety = await fetchPilotValidationSafety(env);
  const accountAudit = await auditPilotAccountCleanliness(env, true);
  const [resolution, tickers] = await Promise.all([
    fetchLivePairResolution(pair),
    fetchAllTickers(),
  ]);

  return buildPilotValidationProposal({
    safety,
    accountAudit,
    resolution,
    tickers,
    pair,
    now,
    idempotencyKey: `validate-only-${crypto.randomUUID()}`,
  });
}
