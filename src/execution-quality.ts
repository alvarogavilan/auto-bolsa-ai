import type { MarketCandidate } from "./market-universe";
import type { PreTradeBook, PreTradeLevel } from "./kraken-pretrade";

export interface BuyFillSimulation {
  covered: boolean;
  requestedQuoteEur: number;
  quoteSpentEur: number;
  baseQuantity: number;
  averagePrice: number | null;
  bestAsk: number | null;
  worstAskUsed: number | null;
  slippagePct: number | null;
  levelsUsed: number;
}

export interface SellFillSimulation {
  covered: boolean;
  requestedBaseQuantity: number;
  baseSold: number;
  grossProceedsEur: number;
  averagePrice: number | null;
  bestBid: number | null;
  worstBidUsed: number | null;
  slippagePct: number | null;
  levelsUsed: number;
}

export interface ExecutionQualityResult {
  schemaVersion: "pretrade-execution-quality-v1";
  symbol: string;
  pairKey: string;
  generatedAt: number;
  notionalEur: number;
  orderBookLevelsAvailable: {
    bids: number;
    asks: number;
  };
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  buy: BuyFillSimulation;
  sell: SellFillSimulation | null;
  buyFeeEur: number;
  sellFeeEur: number | null;
  initialOutflowEur: number;
  immediateNetProceedsEur: number | null;
  immediateRoundTripLossEur: number | null;
  immediateRoundTripCostPct: number | null;
  range24hPct: number;
  rangeToRoundTripCostMultiple: number | null;
  fastMarketFilterPassed: boolean;
  orderBookCoveragePassed: boolean;
  costHurdlePassed: boolean;
  fastExecutionEligible: boolean;
  blocker: string | null;
  message: string;
  liveTrading: false;
}

function round(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function simulateMarketBuy(levels: PreTradeLevel[], quoteEur: number): BuyFillSimulation {
  const asks = [...levels].sort((left, right) => left.price - right.price);
  let remainingQuote = Math.max(0, quoteEur);
  let quoteSpent = 0;
  let baseQuantity = 0;
  let levelsUsed = 0;
  let worstAskUsed: number | null = null;

  for (const level of asks) {
    if (remainingQuote <= 1e-12) break;
    if (level.price <= 0 || level.quantity <= 0) continue;
    const availableQuote = level.price * level.quantity;
    const quoteAtLevel = Math.min(remainingQuote, availableQuote);
    const baseAtLevel = quoteAtLevel / level.price;
    quoteSpent += quoteAtLevel;
    baseQuantity += baseAtLevel;
    remainingQuote -= quoteAtLevel;
    levelsUsed += 1;
    worstAskUsed = level.price;
  }

  const covered = remainingQuote <= Math.max(1e-8, quoteEur * 1e-8);
  const averagePrice = baseQuantity > 0 ? quoteSpent / baseQuantity : null;
  const bestAsk = asks[0]?.price ?? null;
  const slippagePct = averagePrice !== null && bestAsk !== null && bestAsk > 0
    ? Math.max(0, averagePrice / bestAsk - 1)
    : null;

  return {
    covered,
    requestedQuoteEur: quoteEur,
    quoteSpentEur: round(quoteSpent),
    baseQuantity: round(baseQuantity),
    averagePrice: averagePrice === null ? null : round(averagePrice),
    bestAsk,
    worstAskUsed,
    slippagePct: slippagePct === null ? null : round(slippagePct),
    levelsUsed,
  };
}

export function simulateMarketSell(levels: PreTradeLevel[], baseQuantity: number): SellFillSimulation {
  const bids = [...levels].sort((left, right) => right.price - left.price);
  let remainingBase = Math.max(0, baseQuantity);
  let baseSold = 0;
  let grossProceeds = 0;
  let levelsUsed = 0;
  let worstBidUsed: number | null = null;

  for (const level of bids) {
    if (remainingBase <= 1e-12) break;
    if (level.price <= 0 || level.quantity <= 0) continue;
    const baseAtLevel = Math.min(remainingBase, level.quantity);
    baseSold += baseAtLevel;
    grossProceeds += baseAtLevel * level.price;
    remainingBase -= baseAtLevel;
    levelsUsed += 1;
    worstBidUsed = level.price;
  }

  const covered = remainingBase <= Math.max(1e-12, baseQuantity * 1e-8);
  const averagePrice = baseSold > 0 ? grossProceeds / baseSold : null;
  const bestBid = bids[0]?.price ?? null;
  const slippagePct = averagePrice !== null && bestBid !== null && bestBid > 0
    ? Math.max(0, 1 - averagePrice / bestBid)
    : null;

  return {
    covered,
    requestedBaseQuantity: baseQuantity,
    baseSold: round(baseSold),
    grossProceedsEur: round(grossProceeds),
    averagePrice: averagePrice === null ? null : round(averagePrice),
    bestBid,
    worstBidUsed,
    slippagePct: slippagePct === null ? null : round(slippagePct),
    levelsUsed,
  };
}

export function analyzeExecutionQuality(
  candidate: MarketCandidate,
  book: PreTradeBook,
  notionalEur = 10,
  takerFeePctEachSide = 0.004,
): ExecutionQualityResult {
  const buy = simulateMarketBuy(book.asks, notionalEur);
  const bestAsk = book.asks[0]?.price ?? candidate.ask;
  const bestBid = book.bids[0]?.price ?? candidate.bid;
  const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
  const spreadPct = mid > 0 ? Math.max(0, (bestAsk - bestBid) / mid) : Number.POSITIVE_INFINITY;
  const sell = buy.baseQuantity > 0 ? simulateMarketSell(book.bids, buy.baseQuantity) : null;
  const buyFeeEur = buy.quoteSpentEur * takerFeePctEachSide;
  const sellFeeEur = sell ? sell.grossProceedsEur * takerFeePctEachSide : null;
  const initialOutflowEur = buy.quoteSpentEur + buyFeeEur;
  const immediateNetProceedsEur = sell && sellFeeEur !== null
    ? sell.grossProceedsEur - sellFeeEur
    : null;
  const immediateRoundTripLossEur = immediateNetProceedsEur === null
    ? null
    : Math.max(0, initialOutflowEur - immediateNetProceedsEur);
  const immediateRoundTripCostPct = immediateRoundTripLossEur === null || initialOutflowEur <= 0
    ? null
    : immediateRoundTripLossEur / initialOutflowEur;
  const rangeToRoundTripCostMultiple = immediateRoundTripCostPct !== null && immediateRoundTripCostPct > 0
    ? candidate.range24hPct / immediateRoundTripCostPct
    : null;
  const orderBookCoveragePassed = buy.covered && sell?.covered === true;
  const fastMarketFilterPassed = candidate.fastEligible;
  const costHurdlePassed = immediateRoundTripCostPct !== null
    && immediateRoundTripCostPct <= 0.015
    && (rangeToRoundTripCostMultiple ?? 0) >= 2.25;
  const fastExecutionEligible = fastMarketFilterPassed
    && orderBookCoveragePassed
    && costHurdlePassed;

  let blocker: string | null = null;
  if (!fastMarketFilterPassed) blocker = "market-filter-not-passed";
  else if (!buy.covered) blocker = "insufficient-ask-depth-for-ten-eur";
  else if (!sell?.covered) blocker = "insufficient-bid-depth-for-round-trip";
  else if (immediateRoundTripCostPct === null) blocker = "round-trip-cost-unavailable";
  else if (immediateRoundTripCostPct > 0.015) blocker = "immediate-round-trip-cost-too-high";
  else if ((rangeToRoundTripCostMultiple ?? 0) < 2.25) blocker = "daily-range-does-not-cover-cost-hurdle";

  return {
    schemaVersion: "pretrade-execution-quality-v1",
    symbol: candidate.symbol,
    pairKey: candidate.pairKey,
    generatedAt: book.fetchedAt,
    notionalEur,
    orderBookLevelsAvailable: {
      bids: book.bids.length,
      asks: book.asks.length,
    },
    bestBid,
    bestAsk,
    spreadPct: round(spreadPct),
    buy,
    sell,
    buyFeeEur: round(buyFeeEur),
    sellFeeEur: sellFeeEur === null ? null : round(sellFeeEur),
    initialOutflowEur: round(initialOutflowEur),
    immediateNetProceedsEur: immediateNetProceedsEur === null ? null : round(immediateNetProceedsEur),
    immediateRoundTripLossEur: immediateRoundTripLossEur === null ? null : round(immediateRoundTripLossEur),
    immediateRoundTripCostPct: immediateRoundTripCostPct === null ? null : round(immediateRoundTripCostPct),
    range24hPct: candidate.range24hPct,
    rangeToRoundTripCostMultiple: rangeToRoundTripCostMultiple === null ? null : round(rangeToRoundTripCostMultiple),
    fastMarketFilterPassed,
    orderBookCoveragePassed,
    costHurdlePassed,
    fastExecutionEligible,
    blocker,
    message: fastExecutionEligible
      ? "El libro actual absorbe 10 EUR y el recorrido de 24 h supera el umbral de costes; sigue siendo solo candidato PAPER."
      : "El mercado no supera todavía todos los filtros de ejecución rápida.",
    liveTrading: false,
  };
}
