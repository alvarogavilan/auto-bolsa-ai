import type { KrakenAssetPair, KrakenTicker } from "./kraken";

export type ResearchLaneId = "fast" | "intraday" | "swing";

export interface FeeModel {
  version: "kraken-spot-tier0-2026-07";
  makerFeePctEachSide: number;
  takerFeePctEachSide: number;
  makerSlippageBufferPctRoundTrip: number;
  takerSlippageBufferPctRoundTrip: number;
}

export interface ResearchLane {
  id: ResearchLaneId;
  label: string;
  candleIntervalMinutes: number;
  intendedHoldingPeriod: string;
  maximumSpreadPct: number;
  minimumEurVolume24h: number;
  minimumRangeToTakerBreakevenMultiple: number;
  warning: string;
}

export interface MarketCandidate {
  pairKey: string;
  symbol: string;
  base: string;
  quote: "EUR";
  status: string;
  ask: number;
  bid: number;
  last: number;
  spreadPct: number;
  range24hPct: number;
  volume24hBase: number;
  volume24hEur: number;
  trades24h: number;
  orderMinimumBase: number;
  costMinimumEur: number;
  estimatedOrderMinimumEur: number;
  capitalFit: boolean;
  maximumPaperAllocationEur: number;
  takerRoundTripCostPct: number;
  makerRoundTripCostPct: number;
  fastEligible: boolean;
  intradayEligible: boolean;
  swingEligible: boolean;
  exclusionReasons: string[];
  score: number;
}

export interface MarketUniverse {
  schemaVersion: "kraken-eur-market-universe-v1";
  generatedAt: number;
  capitalEur: number;
  maximumPaperAllocationEur: number;
  feeModel: FeeModel;
  lanes: ResearchLane[];
  eurMarketsDiscovered: number;
  onlineEurMarkets: number;
  capitalCompatibleMarkets: number;
  topByLane: Record<ResearchLaneId, MarketCandidate[]>;
  candidates: MarketCandidate[];
  excludedReasonCounts: Record<string, number>;
  opportunityMap: Array<{
    route: string;
    status: "research-now" | "research-later" | "excluded";
    reason: string;
  }>;
  liveTrading: false;
}

export const DEFAULT_FEE_MODEL: FeeModel = {
  version: "kraken-spot-tier0-2026-07",
  makerFeePctEachSide: 0.0023,
  takerFeePctEachSide: 0.004,
  makerSlippageBufferPctRoundTrip: 0.001,
  takerSlippageBufferPctRoundTrip: 0.002,
};

export const RESEARCH_LANES: ResearchLane[] = [
  {
    id: "fast",
    label: "Rápida",
    candleIntervalMinutes: 5,
    intendedHoldingPeriod: "15 minutos a 3 horas",
    maximumSpreadPct: 0.0025,
    minimumEurVolume24h: 2_000_000,
    minimumRangeToTakerBreakevenMultiple: 2.25,
    warning: "Solo PAPER. La frecuencia alta amplifica comisiones, deslizamiento y falsas señales.",
  },
  {
    id: "intraday",
    label: "Intradía",
    candleIntervalMinutes: 15,
    intendedHoldingPeriod: "1 a 12 horas",
    maximumSpreadPct: 0.005,
    minimumEurVolume24h: 500_000,
    minimumRangeToTakerBreakevenMultiple: 1.75,
    warning: "Prioriza liquidez y suficiente recorrido diario para superar costes.",
  },
  {
    id: "swing",
    label: "Medio plazo",
    candleIntervalMinutes: 60,
    intendedHoldingPeriod: "1 a 14 días",
    maximumSpreadPct: 0.01,
    minimumEurVolume24h: 100_000,
    minimumRangeToTakerBreakevenMultiple: 1,
    warning: "Menos operaciones y menor presión de costes, pero mayor exposición temporal.",
  },
];

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function canonicalAsset(value: string): string {
  return value.replace(/^[XZ](?=[A-Z]{3,5}$)/, "").replace("XBT", "BTC");
}

function isEurPair(pair: KrakenAssetPair): boolean {
  return canonicalAsset(pair.quote) === "EUR" || pair.altname.endsWith("EUR") || pair.wsname?.endsWith("/EUR") === true;
}

function eligibleForLane(
  lane: ResearchLane,
  spreadPct: number,
  volume24hEur: number,
  range24hPct: number,
  takerRoundTripCostPct: number,
  capitalFit: boolean,
): boolean {
  return capitalFit
    && spreadPct <= lane.maximumSpreadPct
    && volume24hEur >= lane.minimumEurVolume24h
    && range24hPct >= takerRoundTripCostPct * lane.minimumRangeToTakerBreakevenMultiple;
}

export function evaluateMarketCandidate(
  pair: KrakenAssetPair,
  ticker: KrakenTicker,
  capitalEur: number,
  maximumAllocationPct = 0.2,
  feeModel: FeeModel = DEFAULT_FEE_MODEL,
): MarketCandidate {
  const maximumPaperAllocationEur = Math.max(0, capitalEur * maximumAllocationPct);
  const ask = finite(ticker.ask);
  const bid = finite(ticker.bid);
  const last = finite(ticker.last);
  const middle = ask > 0 && bid > 0 ? (ask + bid) / 2 : last;
  const spreadPct = middle > 0 ? Math.max(0, (ask - bid) / middle) : Number.POSITIVE_INFINITY;
  const rangeReference = ticker.open24h > 0 ? ticker.open24h : middle;
  const range24hPct = rangeReference > 0
    ? Math.max(0, (ticker.high24h - ticker.low24h) / rangeReference)
    : 0;
  const volume24hEur = Math.max(0, ticker.volume24h * (ticker.vwap24h || middle));
  const estimatedOrderMinimumEur = Math.max(
    pair.costmin,
    pair.ordermin * Math.max(ask, last),
  );
  const capitalFit = estimatedOrderMinimumEur > 0
    && estimatedOrderMinimumEur <= maximumPaperAllocationEur;
  const takerRoundTripCostPct = feeModel.takerFeePctEachSide * 2
    + spreadPct
    + feeModel.takerSlippageBufferPctRoundTrip;
  const makerRoundTripCostPct = feeModel.makerFeePctEachSide * 2
    + spreadPct
    + feeModel.makerSlippageBufferPctRoundTrip;

  const fastEligible = eligibleForLane(
    RESEARCH_LANES[0]!,
    spreadPct,
    volume24hEur,
    range24hPct,
    takerRoundTripCostPct,
    capitalFit,
  );
  const intradayEligible = eligibleForLane(
    RESEARCH_LANES[1]!,
    spreadPct,
    volume24hEur,
    range24hPct,
    takerRoundTripCostPct,
    capitalFit,
  );
  const swingEligible = eligibleForLane(
    RESEARCH_LANES[2]!,
    spreadPct,
    volume24hEur,
    range24hPct,
    takerRoundTripCostPct,
    capitalFit,
  );

  const exclusionReasons: string[] = [];
  if (pair.status !== "online") exclusionReasons.push("market-not-online");
  if (!capitalFit) exclusionReasons.push("minimum-order-exceeds-allocation");
  if (spreadPct > RESEARCH_LANES[2]!.maximumSpreadPct) exclusionReasons.push("spread-too-wide");
  if (volume24hEur < RESEARCH_LANES[2]!.minimumEurVolume24h) exclusionReasons.push("liquidity-too-low");
  if (range24hPct < takerRoundTripCostPct) exclusionReasons.push("daily-range-below-taker-breakeven");

  const liquidityScore = clamp((Math.log10(volume24hEur + 1) - 4) / 5);
  const spreadScore = Number.isFinite(spreadPct) ? clamp(1 - spreadPct / 0.01) : 0;
  const rangeScore = takerRoundTripCostPct > 0
    ? clamp(range24hPct / (takerRoundTripCostPct * 3))
    : 0;
  const tradeActivityScore = clamp(Math.log10(Math.max(1, ticker.trades24h)) / 5);
  const eligibilityBonus = fastEligible ? 0.15 : intradayEligible ? 0.1 : swingEligible ? 0.05 : 0;
  const score = Math.round(
    (liquidityScore * 0.35 + spreadScore * 0.3 + rangeScore * 0.2 + tradeActivityScore * 0.15 + eligibilityBonus)
      * 10_000,
  ) / 100;

  return {
    pairKey: pair.key,
    symbol: pair.wsname ?? pair.altname,
    base: canonicalAsset(pair.base),
    quote: "EUR",
    status: pair.status,
    ask,
    bid,
    last,
    spreadPct,
    range24hPct,
    volume24hBase: ticker.volume24h,
    volume24hEur,
    trades24h: ticker.trades24h,
    orderMinimumBase: pair.ordermin,
    costMinimumEur: pair.costmin,
    estimatedOrderMinimumEur,
    capitalFit,
    maximumPaperAllocationEur,
    takerRoundTripCostPct,
    makerRoundTripCostPct,
    fastEligible,
    intradayEligible,
    swingEligible,
    exclusionReasons,
    score,
  };
}

function rankForLane(candidates: MarketCandidate[], lane: ResearchLaneId, limit: number): MarketCandidate[] {
  const field = lane === "fast" ? "fastEligible" : lane === "intraday" ? "intradayEligible" : "swingEligible";
  return candidates
    .filter((candidate) => candidate[field])
    .sort((left, right) => right.score - left.score || right.volume24hEur - left.volume24hEur)
    .slice(0, limit);
}

export function buildMarketUniverse(
  pairs: KrakenAssetPair[],
  tickers: Record<string, KrakenTicker>,
  capitalEur = 50,
): MarketUniverse {
  const eurPairs = pairs.filter(isEurPair);
  const onlinePairs = eurPairs.filter((pair) => pair.status === "online");
  const candidates = onlinePairs
    .map((pair) => {
      const ticker = tickers[pair.key] ?? tickers[pair.altname];
      return ticker ? evaluateMarketCandidate(pair, ticker, capitalEur) : null;
    })
    .filter((candidate): candidate is MarketCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score || right.volume24hEur - left.volume24hEur);

  const excludedReasonCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const reason of candidate.exclusionReasons) {
      excludedReasonCounts[reason] = (excludedReasonCounts[reason] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: "kraken-eur-market-universe-v1",
    generatedAt: Date.now(),
    capitalEur,
    maximumPaperAllocationEur: capitalEur * 0.2,
    feeModel: DEFAULT_FEE_MODEL,
    lanes: RESEARCH_LANES,
    eurMarketsDiscovered: eurPairs.length,
    onlineEurMarkets: onlinePairs.length,
    capitalCompatibleMarkets: candidates.filter((candidate) => candidate.capitalFit).length,
    topByLane: {
      fast: rankForLane(candidates, "fast", 5),
      intraday: rankForLane(candidates, "intraday", 8),
      swing: rankForLane(candidates, "swing", 12),
    },
    candidates: candidates.slice(0, 50),
    excludedReasonCounts,
    opportunityMap: [
      {
        route: "spot-crypto-eur",
        status: "research-now",
        reason: "Disponible con la cuenta actual, sin apalancamiento y compatible con PAPER automático.",
      },
      {
        route: "medium-term-spot",
        status: "research-now",
        reason: "Reduce rotación y presión de comisiones; se comparará en paralelo con la vía rápida.",
      },
      {
        route: "stablecoin-and-fx-pairs",
        status: "research-later",
        reason: "Costes algo menores, pero con 50 EUR el recorrido y beneficio absoluto suelen ser limitados.",
      },
      {
        route: "cross-exchange-arbitrage",
        status: "research-later",
        reason: "Requiere fondos repartidos entre varios exchanges y añade riesgo operativo y de transferencias.",
      },
      {
        route: "market-making",
        status: "research-later",
        reason: "Exige datos de libro en tiempo real, control de inventario y fills maker; no es una vía inicial segura.",
      },
      {
        route: "margin-and-futures",
        status: "excluded",
        reason: "El apalancamiento y la liquidación no son compatibles con el capital inicial ni la política de seguridad.",
      },
      {
        route: "earn-or-staking",
        status: "excluded",
        reason: "No responde al objetivo de compra/venta y la clave API no tiene permisos Earn.",
      },
    ],
    liveTrading: false,
  };
}
