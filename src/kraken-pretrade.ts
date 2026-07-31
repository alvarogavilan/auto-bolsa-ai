const PRETRADE_URL = "https://api.kraken.com/0/public/PreTrade";

type KrakenPreTradeResponse = {
  error: string[];
  result: {
    symbol: string;
    description?: string;
    base_asset?: string;
    quote_asset?: string;
    bids: Array<Record<string, unknown>>;
    asks: Array<Record<string, unknown>>;
  };
};

export interface PreTradeLevel {
  price: number;
  quantity: number;
  orderCount: number;
  publishedAt: string | null;
}

export interface PreTradeBook {
  symbol: string;
  baseAsset: string | null;
  quoteAsset: string | null;
  bids: PreTradeLevel[];
  asks: PreTradeLevel[];
  fetchedAt: number;
}

function numeric(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid PreTrade ${label}`);
  return parsed;
}

function parseLevel(raw: Record<string, unknown>): PreTradeLevel {
  return {
    price: numeric(raw.price, "price"),
    quantity: numeric(raw.qty, "quantity"),
    orderCount: numeric(raw.count, "count"),
    publishedAt: typeof raw.publication_ts === "string" ? raw.publication_ts : null,
  };
}

export async function fetchPreTradeBook(symbol: string): Promise<PreTradeBook> {
  const url = new URL(PRETRADE_URL);
  url.searchParams.set("symbol", symbol);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "auto-bolsa-ai/0.16",
    },
  });
  if (!response.ok) throw new Error(`Kraken PreTrade HTTP ${response.status}`);
  const payload = (await response.json()) as KrakenPreTradeResponse;
  if (payload.error?.length > 0) throw new Error(`Kraken PreTrade: ${payload.error.join(", ")}`);
  if (!payload.result || !Array.isArray(payload.result.bids) || !Array.isArray(payload.result.asks)) {
    throw new Error("Kraken PreTrade order book missing");
  }

  const bids = payload.result.bids.map(parseLevel).filter((level) => level.price > 0 && level.quantity > 0);
  const asks = payload.result.asks.map(parseLevel).filter((level) => level.price > 0 && level.quantity > 0);
  if (bids.length === 0 || asks.length === 0) throw new Error("Kraken PreTrade order book empty");

  return {
    symbol: payload.result.symbol || symbol,
    baseAsset: typeof payload.result.base_asset === "string" ? payload.result.base_asset : null,
    quoteAsset: typeof payload.result.quote_asset === "string" ? payload.result.quote_asset : null,
    bids: bids.sort((left, right) => right.price - left.price),
    asks: asks.sort((left, right) => left.price - right.price),
    fetchedAt: Date.now(),
  };
}
