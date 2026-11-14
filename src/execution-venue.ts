import { fetchTickers, type KrakenTicker } from "./kraken-markets";
import type { Env } from "./types";

/**
 * Plataforma donde el usuario ejecuta a mano las órdenes.
 *
 * Las estrategias siguen analizando con datos de Kraken, pero el precio, el
 * par y las instrucciones de cada orden salen de la plataforma de ejecución,
 * para que el número que ve el usuario sea el que encontrará al operar.
 */
export interface ExecutionVenue {
  id: "cryptocom" | "kraken";
  name: string;
  url: string;
}

const VENUES: Record<ExecutionVenue["id"], ExecutionVenue> = {
  cryptocom: { id: "cryptocom", name: "Crypto.com", url: "https://crypto.com/exchange/" },
  kraken: { id: "kraken", name: "Kraken", url: "https://pro.kraken.com/" },
};

export function executionVenue(env: Pick<Env, "EXECUTION_VENUE">): ExecutionVenue {
  return env.EXECUTION_VENUE === "kraken" ? VENUES.kraken : VENUES.cryptocom;
}

/** Activo base de un par EUR de Kraken: XXBTZEUR → BTC, PAXGEUR → PAXG. */
export function baseAssetOfPair(pair: string): string {
  const normalized = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let base = normalized.replace(/Z?EUR$/, "");
  if (/^[XZ][A-Z]{3}$/.test(base)) base = base.slice(1);
  return base === "XBT" ? "BTC" : base === "XDG" ? "DOGE" : base;
}

export function cryptoComInstrument(pair: string): string {
  return `${baseAssetOfPair(pair)}_EUR`;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Acepta el formato corto de la API pública (b, k, a…) y el descriptivo. */
export function parseCryptoComTicker(raw: Record<string, unknown>): KrakenTicker | null {
  const bid = numeric(raw.b ?? raw.best_bid);
  const ask = numeric(raw.k ?? raw.best_ask);
  const last = numeric(raw.a ?? raw.last);
  if (!(bid > 0) || !(ask > 0)) return null;
  const change = numeric(raw.c ?? raw.change);
  const reference = last > 0 ? last : (bid + ask) / 2;
  return {
    ask,
    bid,
    last: reference,
    volume24h: numeric(raw.v ?? raw.volume),
    vwap24h: reference,
    trades24h: 0,
    low24h: numeric(raw.l ?? raw.low),
    high24h: numeric(raw.h ?? raw.high),
    open24h: change > -1 ? reference / (1 + change) : 0,
  };
}

async function fetchCryptoComTicker(instrument: string): Promise<KrakenTicker | null> {
  const response = await fetch(`https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${encodeURIComponent(instrument)}`, {
    headers: { Accept: "application/json", "User-Agent": "auto-bolsa-ai/1.0" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Crypto.com HTTP ${response.status}`);
  const payload = await response.json<{ code?: number; result?: { data?: Array<Record<string, unknown>> } }>();
  const row = payload.result?.data?.find((entry) => entry.i === instrument || entry.instrument_name === instrument) ?? payload.result?.data?.[0];
  return row ? parseCryptoComTicker(row) : null;
}

/**
 * Precios vivos de la plataforma de ejecución, indexados por el par de la
 * señal (formato Kraken). Un par sin mercado en la plataforma queda ausente,
 * y sin precio verificable no se emite ninguna COMPRA.
 */
export async function fetchVenueTickers(env: Pick<Env, "EXECUTION_VENUE">, pairs: string[]): Promise<Record<string, KrakenTicker>> {
  const unique = [...new Set(pairs)];
  if (unique.length === 0) return {};
  if (executionVenue(env).id === "kraken") return fetchTickers(unique);
  const settled = await Promise.allSettled(unique.map((pair) => fetchCryptoComTicker(cryptoComInstrument(pair))));
  if (settled.every((entry) => entry.status === "rejected")) throw new Error("Crypto.com sin respuesta");
  const tickers: Record<string, KrakenTicker> = {};
  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled" && entry.value) tickers[unique[index] as string] = entry.value;
  });
  return tickers;
}
