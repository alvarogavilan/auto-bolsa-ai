import { fetchTradableAssetPairs, type KrakenAssetPair } from "./kraken-markets";

export interface KrakenGoldInstrument {
  broker: "kraken";
  asset: "gold";
  token: "PAXG" | "XAUT";
  pairKey: string;
  altname: string;
  symbol: string;
  base: string;
  quote: string;
  orderMinBase: number;
  costMinQuote: number;
  lotDecimals: number;
  priceDecimals: number;
  tickSize: number | null;
  status: string;
  tradable: boolean;
  verifiedAt: number;
}

const GOLD_TOKENS = ["PAXG", "XAUT"] as const;
const EUR_QUOTES = new Set(["EUR", "ZEUR"]);

function canonicalAsset(value: string): string {
  return value.replace(/^X|^Z/, "").toUpperCase();
}

function goldToken(pair: KrakenAssetPair): "PAXG" | "XAUT" | null {
  const candidates = [pair.base, pair.altname, pair.wsname ?? "", pair.key].map((value) => value.toUpperCase());
  for (const token of GOLD_TOKENS) {
    if (candidates.some((value) => value.includes(token))) return token;
  }
  return null;
}

function eurQuoted(pair: KrakenAssetPair): boolean {
  if (EUR_QUOTES.has(pair.quote.toUpperCase())) return true;
  if (pair.wsname?.toUpperCase().endsWith("/EUR")) return true;
  return pair.altname.toUpperCase().endsWith("EUR");
}

function tradableStatus(status: string): boolean {
  return ["online", "post_only", "limit_only"].includes(status.toLowerCase());
}

export function selectKrakenGoldInstrument(
  pairs: KrakenAssetPair[],
  now = Date.now(),
): KrakenGoldInstrument | null {
  const candidates = pairs
    .map((pair) => ({ pair, token: goldToken(pair) }))
    .filter((entry): entry is { pair: KrakenAssetPair; token: "PAXG" | "XAUT" } => Boolean(entry.token))
    .filter(({ pair }) => eurQuoted(pair))
    .sort((left, right) => {
      const leftTradable = tradableStatus(left.pair.status) ? 1 : 0;
      const rightTradable = tradableStatus(right.pair.status) ? 1 : 0;
      if (leftTradable !== rightTradable) return rightTradable - leftTradable;
      const leftPriority = left.token === "PAXG" ? 0 : 1;
      const rightPriority = right.token === "PAXG" ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.pair.key.localeCompare(right.pair.key);
    });

  const selected = candidates[0];
  if (!selected) return null;
  const { pair, token } = selected;
  const base = canonicalAsset(pair.base) || token;
  const quote = canonicalAsset(pair.quote) || "EUR";
  return {
    broker: "kraken",
    asset: "gold",
    token,
    pairKey: pair.key,
    altname: pair.altname,
    symbol: pair.wsname ?? `${token}/EUR`,
    base,
    quote,
    orderMinBase: pair.ordermin,
    costMinQuote: pair.costmin,
    lotDecimals: pair.lotDecimals,
    priceDecimals: pair.pairDecimals,
    tickSize: pair.tickSize,
    status: pair.status,
    tradable: tradableStatus(pair.status),
    verifiedAt: now,
  };
}

export async function discoverKrakenGoldInstrument(now = Date.now()): Promise<KrakenGoldInstrument | null> {
  return selectKrakenGoldInstrument(await fetchTradableAssetPairs(), now);
}
