import { fetchAllTickers, type KrakenTicker } from "./kraken-markets";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import type { LiveOrderRequest } from "./live-executor";
import {
  fetchPilotAccountSafety,
  type PilotAccountSafety,
} from "./pilot-account-safety";
import type { Env } from "./types";

const FEE_RESERVE_PCT = 0.01;
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
  feeReservePct: number;
  request: LiveOrderRequest;
  validateOnly: true;
  realOrderCreated: false;
  liveTrading: false;
}

export interface PilotValidationProposalDependencies {
  safety: PilotAccountSafety;
  resolution: LivePairResolution;
  tickers: Record<string, KrakenTicker>;
  pair: string;
  now: number;
  idempotencyKey: string;
}

/** Función pura y determinista para probar límites, cuantización y aliases. */
export function buildPilotValidationProposal(
  dependencies: PilotValidationProposalDependencies,
): PilotValidationProposal {
  const { safety, resolution, tickers, pair, now, idempotencyKey } = dependencies;
  if (!safety.connection.connected) throw new Error("Kraken no está autenticado");
  if (!safety.permissions.auditComplete || !safety.permissions.safePermissions) {
    throw new Error("Los permisos Kraken no están auditados como seguros");
  }
  const eurBalance = safety.connection.eurBalance;
  if (!Number.isFinite(eurBalance) || (eurBalance ?? 0) <= 0) throw new Error("Saldo EUR no disponible o no positivo");
  if (safety.connection.nonZeroAssetCount !== 1) {
    throw new Error("La cuenta Kraken contiene activos adicionales o el inventario no es verificable");
  }
  if (safety.connection.openOrderCount === null) {
    throw new Error("No se pudo verificar si existen órdenes abiertas previas en Kraken");
  }
  if (safety.connection.openOrderCount !== 0 || safety.connection.accountClean !== true) {
    throw new Error("La cuenta Kraken no está limpia: existen órdenes abiertas previas o inventario no conciliado");
  }
  if (!idempotencyKey.trim()) throw new Error("Falta idempotencyKey del servidor");

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
  const spendableEur = grossBudgetEur * (1 - FEE_RESERVE_PCT);
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
    feeReservePct: FEE_RESERVE_PCT,
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
  const [safety, resolution, tickers] = await Promise.all([
    fetchPilotAccountSafety(env),
    fetchLivePairResolution(pair),
    fetchAllTickers(),
  ]);
  return buildPilotValidationProposal({
    safety,
    resolution,
    tickers,
    pair,
    now,
    idempotencyKey: `validate-only-${crypto.randomUUID()}`,
  });
}
