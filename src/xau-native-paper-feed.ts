import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

type Bias = "long" | "short" | "neutral";

interface KrakenLevel { price: string; qty: string; publication_ts?: string }
interface KrakenPreTradeBook { bids?: KrakenLevel[]; asks?: KrakenLevel[] }
interface KrakenPreTradeResponse { result?: KrakenPreTradeBook; error?: string[] }
interface KrakenTrade { price: string; trade_ts?: string }
interface KrakenPostTradeTape { trades?: KrakenTrade[] }
interface KrakenPostTradeResponse { result?: KrakenPostTradeTape; error?: string[] }

const PRE_TRADE_URL = "https://api.kraken.com/0/public/PreTrade?symbol=XAUT/USD";
const POST_TRADE_URL = "https://api.kraken.com/0/public/PostTrade?symbol=XAUT/USD&count=200";

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function direction(changePct: number, deadband = 0.03): Bias {
  return changePct > deadband ? "long" : changePct < -deadband ? "short" : "neutral";
}

function sessionAt(now: number): XauPaperRuntimeInput["cabinet"]["session"] {
  const hour = new Date(now).getUTCHours();
  if (hour >= 12 && hour < 16) return "overlap";
  if (hour >= 7 && hour < 16) return "london";
  if (hour >= 12 && hour < 21) return "new-york";
  return "asia";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`XAU native feed HTTP ${response.status}`);
  return response.json<T>();
}

function requireResult<T>(payload: { result?: T; error?: string[] }, label: string): T {
  const errors = payload.error ?? [];
  if (errors.length) throw new Error(`Kraken XAUT/USD feed error: ${errors.join(", ")}`);
  if (!payload.result) throw new Error(`Kraken XAUT/USD returned no ${label} result`);
  return payload.result;
}

function quoteFromBook(book: KrakenPreTradeBook, now: number): {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  observedAt: number;
} {
  const bid = positive(book.bids?.[0]?.price);
  const ask = positive(book.asks?.[0]?.price);
  if (bid === null || ask === null || ask <= bid) throw new Error("Kraken XAUT/USD returned an invalid order book");
  return {
    bid,
    ask,
    bidQty: positive(book.bids?.[0]?.qty) ?? 0,
    askQty: positive(book.asks?.[0]?.qty) ?? 0,
    observedAt: Math.max(
      Date.parse(book.bids?.[0]?.publication_ts ?? "") || 0,
      Date.parse(book.asks?.[0]?.publication_ts ?? "") || 0,
    ) || now,
  };
}

export async function buildNativeXauFastPriceInput(now = Date.now()): Promise<XauPaperRuntimeInput> {
  const response = await fetchJson<KrakenPreTradeResponse>(PRE_TRADE_URL);
  const quote = quoteFromBook(requireResult(response, "pre-trade"), now);
  const midpoint = (quote.bid + quote.ask) / 2;
  const spreadPct = ((quote.ask - quote.bid) / midpoint) * 100;
  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid: quote.bid, ask: quote.ask, observedAt: quote.observedAt, source: "Kraken public XAUT/USD fast proxy" },
    cabinet: {
      symbol: "XAU/USD",
      session: sessionAt(now),
      technical: {
        trendBias: "neutral",
        marketStructureBias: "neutral",
        liquidityBias: quote.bidQty >= quote.askQty ? "long" : "short",
        momentumBias: "neutral",
        volatilityPct: 0,
        spreadPct,
        distanceToInvalidationPct: 0.25,
        projectedMovePct: 0.5,
      },
      macro: {
        dxyBiasForGold: "neutral",
        realYieldsBiasForGold: "neutral",
        centralBankBias: "neutral",
        inflationBias: "neutral",
        geopoliticalBias: "neutral",
        highImpactEventWithinMinutes: null,
        sourcesAvailable: 0,
        sourcesFresh: 0,
      },
      openXauExposureEur: 0,
      paperEquityEur: 100,
    },
  };
}

export async function buildNativeXauPaperInput(now = Date.now()): Promise<XauPaperRuntimeInput> {
  const [bookResponse, tapeResponse] = await Promise.all([
    fetchJson<KrakenPreTradeResponse>(PRE_TRADE_URL),
    fetchJson<KrakenPostTradeResponse>(POST_TRADE_URL),
  ]);
  const book = requireResult(bookResponse, "pre-trade");
  const tape = requireResult(tapeResponse, "post-trade");
  const quote = quoteFromBook(book, now);
  const prices = (tape.trades ?? []).map((trade) => positive(trade.price)).filter((value): value is number => value !== null);
  if (prices.length < 20) throw new Error("Kraken XAUT/USD returned insufficient trade history");

  const first = prices.at(0);
  const last = prices.at(-1);
  if (first === undefined || last === undefined) throw new Error("Kraken XAUT/USD returned no usable prices");
  const midpoint = (quote.bid + quote.ask) / 2;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const half = Math.floor(prices.length / 2);
  const earlyAverage = prices.slice(0, half).reduce((sum, value) => sum + value, 0) / half;
  const lateAverage = prices.slice(half).reduce((sum, value) => sum + value, 0) / (prices.length - half);
  const trendPct = ((last - first) / first) * 100;
  const momentumPct = ((lateAverage - earlyAverage) / earlyAverage) * 100;
  const spreadPct = ((quote.ask - quote.bid) / midpoint) * 100;
  const rangePct = ((high - low) / midpoint) * 100;
  const invalidationPct = Math.max(0.12, Math.min(0.6, rangePct * 0.35));
  const projectedMovePct = Math.max(invalidationPct * 2, Math.min(1.8, rangePct * 0.9));
  const observedAt = Math.max(
    quote.observedAt,
    Date.parse(tape.trades?.[tape.trades.length - 1]?.trade_ts ?? "") || 0,
  ) || now;

  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid: quote.bid, ask: quote.ask, observedAt, source: "Kraken public XAUT/USD proxy" },
    cabinet: {
      symbol: "XAU/USD",
      session: sessionAt(now),
      technical: {
        trendBias: direction(trendPct),
        marketStructureBias: midpoint >= (high + low) / 2 ? "long" : "short",
        liquidityBias: quote.bidQty >= quote.askQty ? "long" : "short",
        momentumBias: direction(momentumPct),
        volatilityPct: rangePct,
        spreadPct,
        distanceToInvalidationPct: invalidationPct,
        projectedMovePct,
      },
      macro: {
        dxyBiasForGold: "neutral",
        realYieldsBiasForGold: "neutral",
        centralBankBias: "neutral",
        inflationBias: "neutral",
        geopoliticalBias: "neutral",
        highImpactEventWithinMinutes: null,
        sourcesAvailable: 1,
        sourcesFresh: 1,
      },
      openXauExposureEur: 0,
      paperEquityEur: 100,
    },
  };
}
