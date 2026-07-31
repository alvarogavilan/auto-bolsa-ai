import type { Candle, Indicators } from "./types";

export function ema(values: number[], period: number): number {
  if (period <= 0 || values.length < period) {
    throw new Error("Not enough values for EMA");
  }
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) {
    current = value * multiplier + current * (1 - multiplier);
  }
  return current;
}

export function rsi(values: number[], period: number): number {
  if (period <= 0 || values.length <= period) {
    throw new Error("Not enough values for RSI");
  }

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const current = values[i];
    const previous = values[i - 1];
    if (current === undefined || previous === undefined) throw new Error("Invalid RSI data");
    const change = current - previous;
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const current = values[i];
    const previous = values[i - 1];
    if (current === undefined || previous === undefined) throw new Error("Invalid RSI data");
    const change = current - previous;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function calculateIndicators(
  candles: Candle[],
  fastPeriod: number,
  slowPeriod: number,
  rsiPeriod: number,
): Indicators {
  const closes = candles.map((candle) => candle.close);
  const required = Math.max(slowPeriod + 2, rsiPeriod + 2);
  if (closes.length < required) throw new Error(`At least ${required} candles are required`);

  const previousCloses = closes.slice(0, -1);
  const price = closes.at(-1);
  if (price === undefined) throw new Error("Missing last price");

  return {
    fastEma: ema(closes, fastPeriod),
    slowEma: ema(closes, slowPeriod),
    previousFastEma: ema(previousCloses, fastPeriod),
    previousSlowEma: ema(previousCloses, slowPeriod),
    rsi: rsi(closes, rsiPeriod),
    price,
  };
}

export type Signal =
  | { action: "buy"; reason: string }
  | { action: "sell"; reason: string }
  | { action: "hold"; reason: string };

export function decide(indicators: Indicators, hasPosition: boolean): Signal {
  const bullishCross =
    indicators.previousFastEma <= indicators.previousSlowEma &&
    indicators.fastEma > indicators.slowEma;
  const bearishCross =
    indicators.previousFastEma >= indicators.previousSlowEma &&
    indicators.fastEma < indicators.slowEma;

  if (!hasPosition && bullishCross && indicators.rsi >= 48 && indicators.rsi <= 65) {
    return { action: "buy", reason: "Cruce EMA alcista con RSI controlado" };
  }

  if (hasPosition && (bearishCross || indicators.rsi >= 72)) {
    return {
      action: "sell",
      reason: bearishCross ? "Cruce EMA bajista" : "RSI en sobrecompra",
    };
  }

  return { action: "hold", reason: "Sin señal válida" };
}
