const API_BASE = "https://api.kraken.com/0";

type KrakenResponse<T> = { error: string[]; result: T };

export interface KrakenAssetPair {
  key: string;
  altname: string;
  wsname: string | null;
  base: string;
  quote: string;
  ordermin: number;
  costmin: number;
  pairDecimals: number;
  lotDecimals: number;
  tickSize: number | null;
  status: string;
}

export interface KrakenTicker {
  ask: number;
  bid: number;
  last: number;
  volume24h: number;
  vwap24h: number;
  trades24h: number;
  low24h: number;
  high24h: number;
  open24h: number;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function arrayNumber(value: unknown, index: number): number {
  return Array.isArray(value) ? numberValue(value[index]) : 0;
}

async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "auto-bolsa-ai/0.14",
    },
  });
  if (!response.ok) throw new Error(`Kraken public HTTP ${response.status}`);
  const payload = (await response.json()) as KrakenResponse<T>;
  if (payload.error.length > 0) throw new Error(`Kraken public: ${payload.error.join(", ")}`);
  return payload.result;
}

export async function fetchTradableAssetPairs(): Promise<KrakenAssetPair[]> {
  const result = await publicGet<Record<string, Record<string, unknown>>>("/public/AssetPairs?info=info");
  return Object.entries(result).map(([key, raw]) => ({
    key,
    altname: stringValue(raw.altname, key),
    wsname: typeof raw.wsname === "string" ? raw.wsname : null,
    base: stringValue(raw.base),
    quote: stringValue(raw.quote),
    ordermin: numberValue(raw.ordermin),
    costmin: numberValue(raw.costmin),
    pairDecimals: numberValue(raw.pair_decimals),
    lotDecimals: numberValue(raw.lot_decimals),
    tickSize: raw.tick_size === undefined || raw.tick_size === null ? null : numberValue(raw.tick_size),
    status: stringValue(raw.status, "unknown"),
  }));
}

export async function fetchTickers(pairs: string[]): Promise<Record<string, KrakenTicker>> {
  if (pairs.length === 0) return {};
  const result = await publicGet<Record<string, Record<string, unknown>>>(`/public/Ticker?pair=${pairs.map(encodeURIComponent).join(",")}`);
  return Object.fromEntries(
    Object.entries(result).map(([key, raw]) => [
      key,
      {
        ask: arrayNumber(raw.a, 0),
        bid: arrayNumber(raw.b, 0),
        last: arrayNumber(raw.c, 0),
        volume24h: arrayNumber(raw.v, 1),
        vwap24h: arrayNumber(raw.p, 1),
        trades24h: arrayNumber(raw.t, 1),
        low24h: arrayNumber(raw.l, 1),
        high24h: arrayNumber(raw.h, 1),
        open24h: numberValue(raw.o),
      },
    ]),
  );
}

export async function fetchAllTickers(): Promise<Record<string, KrakenTicker>> {
  const result = await publicGet<Record<string, Record<string, unknown>>>("/public/Ticker");
  return Object.fromEntries(
    Object.entries(result).map(([key, raw]) => [
      key,
      {
        ask: arrayNumber(raw.a, 0),
        bid: arrayNumber(raw.b, 0),
        last: arrayNumber(raw.c, 0),
        volume24h: arrayNumber(raw.v, 1),
        vwap24h: arrayNumber(raw.p, 1),
        trades24h: arrayNumber(raw.t, 1),
        low24h: arrayNumber(raw.l, 1),
        high24h: arrayNumber(raw.h, 1),
        open24h: numberValue(raw.o),
      },
    ]),
  );
}
