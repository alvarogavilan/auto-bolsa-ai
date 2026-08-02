import type { Candle } from "./types";

export interface ChartTimeframeView {
  label: "micro" | "short" | "medium" | "long";
  sample: number;
  momentum: number;
  trend: "bullish" | "bearish" | "sideways";
  support: number | null;
  resistance: number | null;
}

export interface ChartIntelligence {
  schemaVersion: "chart-intelligence-v2";
  trend: "bullish" | "bearish" | "sideways";
  regime: "trend" | "range" | "chaotic";
  momentum: number;
  volatilityPct: number;
  support: number | null;
  resistance: number | null;
  confidence: number;
  sizeFactor: number;
  vetoNewLong: boolean;
  breakoutConfirmed: boolean;
  timeframeAgreementPct: number;
  timeframes: ChartTimeframeView[];
  reasons: string[];
  liveTrading: false;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function view(closes: number[], label: ChartTimeframeView["label"], sample: number): ChartTimeframeView {
  const values = closes.slice(-sample);
  const fastSize = Math.max(2, Math.round(sample / 4));
  const fast = average(values.slice(-fastSize));
  const slow = average(values);
  const momentum = slow > 0 ? (fast - slow) / slow : 0;
  const trend = momentum > 0.0012 ? "bullish" : momentum < -0.0012 ? "bearish" : "sideways";
  return {
    label,
    sample: values.length,
    momentum,
    trend,
    support: values.length ? Math.min(...values) : null,
    resistance: values.length ? Math.max(...values) : null,
  };
}

export function interpretChart(candles: Candle[]): ChartIntelligence {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  const recent = closes.slice(-120);
  const timeframes = [
    view(recent, "micro", 8),
    view(recent, "short", 20),
    view(recent, "medium", 50),
    view(recent, "long", 100),
  ];
  const bullish = timeframes.filter((item) => item.trend === "bullish").length;
  const bearish = timeframes.filter((item) => item.trend === "bearish").length;
  const agreement = Math.max(bullish, bearish, timeframes.length - bullish - bearish) / timeframes.length;
  const momentum = average(timeframes.map((item) => item.momentum));
  const returns: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1] ?? 0;
    const current = recent[index] ?? previous;
    returns.push(previous > 0 ? (current - previous) / previous : 0);
  }
  const volatilityPct = Math.sqrt(average(returns.map((value) => value * value)));
  const support = recent.length ? Math.min(...recent) : null;
  const resistance = recent.length ? Math.max(...recent) : null;
  const last = recent.at(-1) ?? 0;
  const priorResistance = recent.length > 5 ? Math.max(...recent.slice(0, -1)) : resistance;
  const breakoutConfirmed = Boolean(priorResistance && last > priorResistance * 1.0015 && bullish >= 3);
  const trend = bullish >= 3 ? "bullish" : bearish >= 3 ? "bearish" : "sideways";
  const regime = volatilityPct > 0.025 ? "chaotic" : trend === "sideways" ? "range" : "trend";
  const confidence = Math.min(0.97, 0.35 + agreement * 0.4 + Math.min(0.18, Math.abs(momentum) * 45) + (breakoutConfirmed ? 0.08 : 0));
  const vetoNewLong = (trend === "bearish" && confidence >= 0.66) || regime === "chaotic";
  const sizeFactor = vetoNewLong ? 0 : trend === "bullish" && agreement >= 0.75 ? Math.min(1.15, 0.82 + confidence * 0.3) : trend === "sideways" ? 0.55 : 0.7;
  return {
    schemaVersion: "chart-intelligence-v2",
    trend,
    regime,
    momentum,
    volatilityPct,
    support,
    resistance,
    confidence,
    sizeFactor,
    vetoNewLong,
    breakoutConfirmed,
    timeframeAgreementPct: agreement,
    timeframes,
    reasons: [
      `Consenso multitemporal ${(agreement * 100).toFixed(0)} %`,
      `Régimen ${regime}; tendencia ${trend}`,
      `Momentum agregado ${(momentum * 100).toFixed(3)} %`,
      `Volatilidad ${(volatilityPct * 100).toFixed(3)} %`,
      breakoutConfirmed ? "Ruptura confirmada por tres o más horizontes" : "Sin ruptura multitemporal confirmada",
    ],
    liveTrading: false,
  };
}
