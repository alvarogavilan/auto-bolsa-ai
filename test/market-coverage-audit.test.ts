import { describe, expect, it } from "vitest";
import { buildMarketCoverageAudit } from "../src/market-coverage-audit";
import type { MarketUniverse } from "../src/market-universe";
import type { ResearchLabState } from "../src/research-lab";

function strategy(id: string, lane: "fast" | "intraday" | "swing", lastDecision: string, trades: any[] = []) {
  return {
    id,
    lane,
    pairKey: id,
    symbol: id,
    base: id,
    status: "active" as const,
    initialCashEur: 50,
    cashEur: 50,
    equityEur: 50,
    peakEquityEur: 50,
    maxDrawdownPct: 0,
    position: null,
    config: {} as any,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.01,
    lastClosedCandleTime: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextDueAt: 0,
    lastTradeAt: null,
    lastDecision,
    cycles: 10,
    uniqueCandles: 8,
    duplicateSkips: 2,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: 0, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: 0 },
    trades,
  };
}

describe("paper market coverage audit", () => {
  it("separates the market universe from the fixed active roster", () => {
    const now = Date.now();
    const state = {
      schemaVersion: "multi-horizon-paper-lab-v1",
      version: "0.17.0-paper",
      mode: "paper",
      initializedAt: now - 86_400_000,
      cohortLockedUntil: now + 86_400_000,
      sourceUniverseGeneratedAt: now,
      lastCycleAt: now,
      cycles: 100,
      strategies: [
        strategy("a", "fast", "Sin señal válida para el carril"),
        strategy("b", "intraday", "Sin nueva vela cerrada para este carril"),
        strategy("c", "swing", "Compra bloqueada: costes"),
      ],
      liveTrading: false,
    } satisfies ResearchLabState;
    const universe = {
      schemaVersion: "kraken-eur-market-universe-v1",
      generatedAt: now,
      eurMarketsDiscovered: 120,
      onlineEurMarkets: 90,
      capitalCompatibleMarkets: 70,
      topByLane: { fast: new Array(5).fill({}), intraday: new Array(8).fill({}), swing: new Array(12).fill({}) },
    } as unknown as MarketUniverse;

    const report = buildMarketCoverageAudit(state, universe, now);
    expect(report.markets.eurDiscovered).toBe(120);
    expect(report.activeRoster.total).toBe(3);
    expect(report.markets.eligibleByLane).toEqual({ fast: 5, intraday: 8, swing: 12 });
    expect(report.currentDecisionFunnel["no-signal"]).toBe(1);
    expect(report.currentDecisionFunnel["no-new-candle"]).toBe(1);
    expect(report.currentDecisionFunnel["risk-or-execution-block"]).toBe(1);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("counts closed operations once and diagnoses low frequency without relaxing safety", () => {
    const now = Date.now();
    const sell = { id: "s1", side: "sell" as const, timestamp: now - 1_000, price: 1, quantity: 1, grossEur: 1, feeEur: 0.01, reason: "test", pnlEur: 0.1 };
    const state = {
      schemaVersion: "multi-horizon-paper-lab-v1",
      version: "0.17.0-paper",
      mode: "paper",
      initializedAt: now,
      cohortLockedUntil: now,
      sourceUniverseGeneratedAt: now,
      lastCycleAt: now,
      cycles: 1,
      strategies: [strategy("a", "fast", "PAPER SELL", [sell])],
      liveTrading: false,
    } satisfies ResearchLabState;

    const report = buildMarketCoverageAudit(state, null, now);
    expect(report.activity.closesLast12h).toBe(1);
    expect(report.activity.winsLast12h).toBe(1);
    expect(report.diagnosis).toContain("Frecuencia baja confirmada");
    expect(report.diagnosis).toContain("No se aumentará la frecuencia relajando seguridad");
  });
});
