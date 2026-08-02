import { describe, expect, it } from "vitest";
import { interpretChart } from "../src/chart-intelligence";
import { buildTreasuryReport } from "../src/treasury-risk";
import type { Candle } from "../src/types";
import type { ResearchLabState } from "../src/research-lab";

function candles(prices: number[]): Candle[] {
  return prices.map((close, index) => ({
    time: index * 60_000,
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 10 + index,
  }));
}

describe("final PAPER readiness", () => {
  it("exige consenso multitemporal y detecta una tendencia alcista persistente", () => {
    const series = Array.from({ length: 120 }, (_, index) => 100 + index * 0.25);
    const report = interpretChart(candles(series));
    expect(report.schemaVersion).toBe("chart-intelligence-v2");
    expect(report.timeframes).toHaveLength(4);
    expect(report.trend).toBe("bullish");
    expect(report.timeframeAgreementPct).toBeGreaterThanOrEqual(0.75);
    expect(report.vetoNewLong).toBe(false);
  });

  it("veta entradas nuevas cuando el régimen es caótico", () => {
    const series = Array.from({ length: 120 }, (_, index) => index % 2 === 0 ? 100 : 106);
    const report = interpretChart(candles(series));
    expect(report.regime).toBe("chaotic");
    expect(report.vetoNewLong).toBe(true);
    expect(report.sizeFactor).toBe(0);
  });

  it("expone un departamento de Tesorería con reserva y tope agregado", () => {
    const state = { strategies: [] } as unknown as ResearchLabState;
    const report = buildTreasuryReport(state);
    expect(report.department).toBe("Treasury & Portfolio Risk");
    expect(report.reserveCashPct).toBe(0.35);
    expect(report.maximumAggregateExposurePct).toBe(0.35);
    expect(report.largeUnboundedBetsAllowed).toBe(false);
    expect(report.liveTrading).toBe(false);
  });
});
