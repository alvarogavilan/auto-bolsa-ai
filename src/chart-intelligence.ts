import type { Candle } from "./types";

export interface ChartIntelligence {
  schemaVersion: "chart-intelligence-v1";
  trend: "bullish" | "bearish" | "sideways";
  momentum: number;
  volatilityPct: number;
  support: number | null;
  resistance: number | null;
  confidence: number;
  sizeFactor: number;
  vetoNewLong: boolean;
  reasons: string[];
  liveTrading: false;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function interpretChart(candles: Candle[]): ChartIntelligence {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  const recent = closes.slice(-20);
  const last = recent.at(-1) ?? 0;
  const fast = average(recent.slice(-5));
  const slow = average(recent);
  const momentum = slow > 0 ? (fast - slow) / slow : 0;
  const returns = recent.slice(1).map((value, index) => recent[index] > 0 ? (value - recent[index]) / recent[index] : 0);
  const volatilityPct = Math.sqrt(average(returns.map((value) => value * value)));
  const support = recent.length ? Math.min(...recent) : null;
  const resistance = recent.length ? Math.max(...recent) : null;
  const trend = momentum > 0.0015 ? "bullish" : momentum < -0.0015 ? "bearish" : "sideways";
  const confidence = Math.min(0.95, 0.5 + Math.abs(momentum) * 60 + Math.min(0.2, recent.length / 100));
  const vetoNewLong = trend === "bearish" && confidence >= 0.7;
  const sizeFactor = vetoNewLong ? 0 : trend === "bullish" ? Math.min(1.15, 0.85 + confidence * 0.25) : 0.7;
  return {
    schemaVersion: "chart-intelligence-v1",
    trend,
    momentum,
    volatilityPct,
    support,
    resistance,
    confidence,
    sizeFactor,
    vetoNewLong,
    reasons: [
      `Tendencia ${trend} por medias de 5 y 20 cierres`,
      `Momentum ${(momentum * 100).toFixed(3)} %`,
      `Volatilidad ${(volatilityPct * 100).toFixed(3)} %`,
    ],
    liveTrading: false,
  };
}
