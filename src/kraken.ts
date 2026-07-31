import type { Candle } from "./types";

const API_BASE = "https://api.kraken.com/0";

type KrakenResponse<T> = { error: string[]; result: T };

function asNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

export async function fetchOhlc(pair: string, interval = 15): Promise<Candle[]> {
  const url = new URL(`${API_BASE}/public/OHLC`);
  url.searchParams.set("pair", pair);
  url.searchParams.set("interval", String(interval));

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "auto-bolsa-ai/0.1" },
  });
  if (!response.ok) throw new Error(`Kraken OHLC HTTP ${response.status}`);

  const payload = (await response.json()) as KrakenResponse<Record<string, unknown>>;
  if (payload.error.length > 0) throw new Error(`Kraken OHLC: ${payload.error.join(", ")}`);

  const resultKey = Object.keys(payload.result).find((key) => key !== "last");
  if (!resultKey) throw new Error("Kraken OHLC pair missing");
  const rows = payload.result[resultKey];
  if (!Array.isArray(rows)) throw new Error("Kraken OHLC candles missing");

  return rows.map((row): Candle => {
    if (!Array.isArray(row) || row.length < 7) throw new Error("Malformed Kraken candle");
    return {
      time: asNumber(row[0], "time"),
      open: asNumber(row[1], "open"),
      high: asNumber(row[2], "high"),
      low: asNumber(row[3], "low"),
      close: asNumber(row[4], "close"),
      volume: asNumber(row[6], "volume"),
    };
  });
}
