import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

type Bias = "long" | "short" | "neutral";

interface KrakenLevel { price: string; qty: string; publication_ts?: string }
interface KrakenPreTradeResult { bids?: KrakenLevel[]; asks?: KrakenLevel[]; error?: string[] }
interface KrakenTrade { price: string; trade_ts?: string }
interface KrakenPostTradeResult { trades?: KrakenTrade[]; error?: string[] }

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

export async function buildNativeXauPaperInput(now = Date.now()): Promise<XauPaperRuntimeInput> {
  const [book, tape] = await Promise.all([
    fetchJson<KrakenPreTradeResult>(PRE_TRADE_URL),
    fetchJson<KrakenPostTradeResult>(POST_TRADE_URL),
  ]);
  const errors = [...(book.error ?? []), ...(tape.error ?? [])];
  if (errors.length) throw new Error(`Kraken XAUT/USD feed error: ${errors.join(", ")}`);

  const bid = positive(book.bids?.[0]?.price);
  const ask = positive(book.asks?.[0]?.price);
  const bidQty = positive(book.bids?.[0]?.qty) ?? 0;
  const askQty = positive(book.asks?.[0]?.qty) ?? 0;
  if (bid === null || ask === null || ask <= bid) throw new Error("Kraken XAUT/USD returned an invalid order book");

  const prices = (tape.trades ?? []).map((trade) => positive(trade.price)).filter((value): value is number => value !== null);
  if (prices.length < 20) throw new Error("Kraken XAUT/USD returned insufficient trade history");

  const first = prices[0];
  const last = prices[prices.length - 1];
  const midpoint = (bid + ask) / 2;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const half = Math.floor(prices.length / 2);
  const earlyAverage = prices.slice(0, half).reduce((sum, value) => sum + value, 0) / half;
  const lateAverage = prices.slice(half).reduce((sum, value) => sum + value, 0) / (prices.length - half);
  const trendPct = ((last - first) / first) * 100;
  const momentumPct = ((lateAverage - earlyAverage) / earlyAverage) * 100;
  const spreadPct = ((ask - bid) / midpoint) * 100;
  const rangePct = ((high - low) / midpoint) * 100;
  const invalidationPct = Math.max(0.12, Math.min(0.6, rangePct * 0.35));
  const projectedMovePct = Math.max(invalidationPct * 2, Math.min(1.8, rangePct * 0.9));
  const observedAt = Math.max(
    Date.parse(book.bids?.[0]?.publication_ts ?? "") || 0,
    Date.parse(book.asks?.[0]?.publication_ts ?? "") || 0,
    Date.parse(tape.trades?.[tape.trades.length - 1]?.trade_ts ?? "") || 0,
  ) || now;

  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid, ask, observedAt, source: "Kraken public XAUT/USD proxy" },
    cabinet: {
      symbol: "XAU/USD",
      session: sessionAt(now),
      technical: {
        trendBias: direction(trendPct),
        marketStructureBias: midpoint >= (high + low) / 2 ? "long" : "short",
        liquidityBias: bidQty >= askQty ? "long" : "short",
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
