import type { Candle } from "./types";

export interface MarketObservation {
  currentPrice: number;
  closedCandles: Candle[];
  latestClosedCandleTime: number;
  isNewClosedCandle: boolean;
}

export function selectMarketObservation(
  candles: Candle[],
  lastClosedCandleTime: number | null,
): MarketObservation {
  if (candles.length < 3) throw new Error("Kraken OHLC returned insufficient candles");

  // Kraken documents the final OHLC row as the current, not-yet-committed candle.
  // It may change on every request, so it is never valid evidence for a decision.
  const current = candles[candles.length - 1];
  const closedCandles = candles.slice(0, -1);
  const latestClosed = closedCandles[closedCandles.length - 1];

  if (!current || !latestClosed) throw new Error("Kraken OHLC candle selection failed");

  return {
    currentPrice: current.close,
    closedCandles,
    latestClosedCandleTime: latestClosed.time,
    isNewClosedCandle: latestClosed.time !== lastClosedCandleTime,
  };
}
