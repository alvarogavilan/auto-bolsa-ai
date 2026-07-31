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

export interface ExitPriceTarget {
  targetNetReturnPct: number;
  requiredAverageExitPrice: number;
  requiredMoveFromAverageBuyPct: number;
  expectedNetProfitEur: number;
}

export interface MakerExecutionPlan {
  makerFeePctEachSide: number;
  theoreticalBreakEvenMovePct: number;
  theoreticalTargetMovePct: number;
  theoreticalFeeSavingsPctVsTaker: number;
  eligibleForPaperResearch: boolean;
  passiveFillEvidenceRequired: true;
  warning: string;
}

export type ExecutionRouteId = "fast-taker" | "intraday-taker" | "swing-taker" | "fast-maker";
export type ExecutionRouteStatus = "paper-candidate" | "research-only" | "rejected";

export interface ExecutionRouteAssessment {
  route: ExecutionRouteId;
  status: ExecutionRouteStatus;
  holdingWindow: string;
  reason: string;
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
  breakEvenTarget: ExitPriceTarget | null;
  modestProfitTarget: ExitPriceTarget | null;
  makerPlan: MakerExecutionPlan;
  range24hPct: number;
  rangeToRoundTripCostMultiple: number | null;
  executionRoutes: ExecutionRouteAssessment[];
  recommendedPaperLane: "fast" | "intraday" | "swing" | null;
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

function theoreticalFeeOnlyMovePct(
  entryFeePct: number,
  exitFeePct: number,
  targetNetReturnPct: number,
): number {
  if (entryFeePct < 0 || exitFeePct < 0 || exitFeePct >= 1 || targetNetReturnPct < -1) {
    return Number.POSITIVE_INFINITY;
  }
  return ((1 + entryFeePct) * (1 + targetNetReturnPct)) / (1 - exitFeePct) - 1;
}

function calculateExitTarget(
  buy: BuyFillSimulation,
  buyFeeEur: number,
  sellFeePct: number,
  targetNetReturnPct: number,
): ExitPriceTarget | null {
  if (
    !buy.covered
    || buy.baseQuantity <= 0
    || buy.averagePrice === null
    || sellFeePct < 0
    || sellFeePct >= 1
  ) {
    return null;
  }

  const initialOutflowEur = buy.quoteSpentEur + buyFeeEur;
  const requiredNetProceedsEur = initialOutflowEur * (1 + targetNetReturnPct);
  const requiredGrossProceedsEur = requiredNetProceedsEur / (1 - sellFeePct);
  const requiredAverageExitPrice = requiredGrossProceedsEur / buy.baseQuantity;
  const requiredMoveFromAverageBuyPct = requiredAverageExitPrice / buy.averagePrice - 1;

  return {
    targetNetReturnPct: round(targetNetReturnPct),
    requiredAverageExitPrice: round(requiredAverageExitPrice),
    requiredMoveFromAverageBuyPct: round(requiredMoveFromAverageBuyPct),
    expectedNetProfitEur: round(initialOutflowEur * targetNetReturnPct),
  };
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

function buildExecutionRoutes(
  candidate: MarketCandidate,
  coveragePassed: boolean,
  immediateRoundTripCostPct: number | null,
  rangeMultiple: number | null,
  makerEligible: boolean,
): { routes: ExecutionRouteAssessment[]; recommendedPaperLane: "fast" | "intraday" | "swing" | null } {
  const cost = immediateRoundTripCostPct ?? Number.POSITIVE_INFINITY;
  const multiple = rangeMultiple ?? 0;
  const fast = candidate.fastEligible && coveragePassed && cost <= 0.015 && multiple >= 2.25;
  const intraday = candidate.intradayEligible && coveragePassed && cost <= 0.02 && multiple >= 1.75;
  const swing = candidate.swingEligible && coveragePassed && multiple >= 1;

  const routes: ExecutionRouteAssessment[] = [
    {
      route: "fast-taker",
      status: fast ? "paper-candidate" : "rejected",
      holdingWindow: "15 minutos a 3 horas",
      reason: fast
        ? "La profundidad y el recorrido superan el coste de cruzar el libro dos veces."
        : "No supera simultáneamente liquidez, coste y recorrido exigidos para compra rápida.",
    },
    {
      route: "intraday-taker",
      status: intraday ? "paper-candidate" : "rejected",
      holdingWindow: "1 a 12 horas",
      reason: intraday
        ? "El horizonte intradía ofrece más margen para absorber costes que la salida inmediata."
        : "El recorrido o la liquidez todavía no justifican una operación intradía.",
    },
    {
      route: "swing-taker",
      status: swing ? "paper-candidate" : "rejected",
      holdingWindow: "1 a 14 días",
      reason: swing
        ? "El mercado puede investigarse con menor rotación y menor presión relativa de comisiones."
        : "Ni siquiera el horizonte medio ofrece recorrido suficiente frente al coste estimado.",
    },
    {
      route: "fast-maker",
      status: makerEligible ? "research-only" : "rejected",
      holdingWindow: "Orden pasiva sin garantía de ejecución",
      reason: makerEligible
        ? "Reduce comisiones teóricas, pero necesita demostrar fills reales en PAPER antes de compararse con taker."
        : "La ventaja teórica maker no compensa la falta de liquidez o el mercado no supera el filtro rápido.",
    },
  ];

  return {
    routes,
    recommendedPaperLane: fast ? "fast" : intraday ? "intraday" : swing ? "swing" : null,
  };
}

export function analyzeExecutionQuality(
  candidate: MarketCandidate,
  book: PreTradeBook,
  notionalEur = 10,
  takerFeePctEachSide = 0.004,
  makerFeePctEachSide = 0.0023,
  modestTargetNetReturnPct = 0.003,
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
  const breakEvenTarget = calculateExitTarget(buy, buyFeeEur, takerFeePctEachSide, 0);
  const modestProfitTarget = calculateExitTarget(
    buy,
    buyFeeEur,
    takerFeePctEachSide,
    modestTargetNetReturnPct,
  );
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
  const makerBreakEvenMovePct = theoreticalFeeOnlyMovePct(makerFeePctEachSide, makerFeePctEachSide, 0);
  const makerTargetMovePct = theoreticalFeeOnlyMovePct(
    makerFeePctEachSide,
    makerFeePctEachSide,
    modestTargetNetReturnPct,
  );
  const makerEligible = fastMarketFilterPassed
    && orderBookCoveragePassed
    && makerFeePctEachSide < takerFeePctEachSide
    && candidate.range24hPct >= makerTargetMovePct * 2.25;
  const makerPlan: MakerExecutionPlan = {
    makerFeePctEachSide: round(makerFeePctEachSide),
    theoreticalBreakEvenMovePct: round(makerBreakEvenMovePct),
    theoreticalTargetMovePct: round(makerTargetMovePct),
    theoreticalFeeSavingsPctVsTaker: round(
      Math.max(0, (takerFeePctEachSide - makerFeePctEachSide) * 2),
    ),
    eligibleForPaperResearch: makerEligible,
    passiveFillEvidenceRequired: true,
    warning: "Una orden maker puede no ejecutarse o hacerlo parcialmente; el ahorro de comisión no es beneficio garantizado.",
  };
  const { routes: executionRoutes, recommendedPaperLane } = buildExecutionRoutes(
    candidate,
    orderBookCoveragePassed,
    immediateRoundTripCostPct,
    rangeToRoundTripCostMultiple,
    makerEligible,
  );

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
    breakEvenTarget,
    modestProfitTarget,
    makerPlan,
    range24hPct: candidate.range24hPct,
    rangeToRoundTripCostMultiple: rangeToRoundTripCostMultiple === null ? null : round(rangeToRoundTripCostMultiple),
    executionRoutes,
    recommendedPaperLane,
    fastMarketFilterPassed,
    orderBookCoveragePassed,
    costHurdlePassed,
    fastExecutionEligible,
    blocker,
    message: fastExecutionEligible
      ? "La vía rápida supera los filtros PAPER, pero vender antes del precio de equilibrio convertiría los costes en pérdida."
      : recommendedPaperLane
        ? `La vía rápida no compensa ahora; el carril ${recommendedPaperLane} ofrece un horizonte PAPER más razonable.`
        : "El mercado no supera todavía ningún carril PAPER después de costes.",
    liveTrading: false,
  };
}
