import type { MarketUniverse, ResearchLaneId } from "./market-universe";
import type { ResearchLabState } from "./research-lab";

export interface MarketCoverageAudit {
  schemaVersion: "paper-market-coverage-audit-v1";
  generatedAt: number;
  universeGeneratedAt: number | null;
  markets: {
    eurDiscovered: number | null;
    online: number | null;
    capitalCompatible: number | null;
    eligibleByLane: Record<ResearchLaneId, number>;
  };
  activeRoster: {
    total: number;
    byLane: Record<ResearchLaneId, number>;
    shareOfEligibleByLane: Record<ResearchLaneId, number | null>;
  };
  activity: {
    cycles: number;
    strategyCycles: number;
    uniqueClosedCandles: number;
    duplicateCandleSkips: number;
    errors: number;
    openPositions: number;
    buysLast12h: number;
    closesLast12h: number;
    winsLast12h: number;
    lossesLast12h: number;
  };
  currentDecisionFunnel: Record<string, number>;
  diagnosis: string;
  changesTradingDecision: false;
  liveTrading: false;
}

const LANES: ResearchLaneId[] = ["fast", "intraday", "swing"];

function countByLane(state: ResearchLabState, lane: ResearchLaneId): number {
  return state.strategies.filter((strategy) => strategy.lane === lane).length;
}

function decisionBucket(value: string): string {
  const text = value.toLowerCase();
  if (text.includes("paper buy")) return "buy";
  if (text.includes("paper sell")) return "sell";
  if (text.includes("sin señal válida")) return "no-signal";
  if (text.includes("sin nueva vela")) return "no-new-candle";
  if (text.includes("cooldown")) return "cooldown";
  if (text.includes("vetada") || text.includes("bloqueada")) return "risk-or-execution-block";
  if (text.includes("error")) return "error";
  if (text.includes("detenido")) return "halted";
  return "other";
}

export function buildMarketCoverageAudit(
  state: ResearchLabState,
  universe: MarketUniverse | null,
  now = Date.now(),
): MarketCoverageAudit {
  const since = now - 12 * 60 * 60_000;
  const trades = state.strategies.flatMap((strategy) => strategy.trades);
  const recentBuys = trades.filter((trade) => trade.side === "buy" && trade.timestamp >= since);
  const recentCloses = trades.filter((trade) => trade.side === "sell" && trade.timestamp >= since && typeof trade.pnlEur === "number");
  const eligibleByLane: Record<ResearchLaneId, number> = {
    fast: universe?.topByLane.fast.length ?? 0,
    intraday: universe?.topByLane.intraday.length ?? 0,
    swing: universe?.topByLane.swing.length ?? 0,
  };
  const byLane: Record<ResearchLaneId, number> = {
    fast: countByLane(state, "fast"),
    intraday: countByLane(state, "intraday"),
    swing: countByLane(state, "swing"),
  };
  const funnel: Record<string, number> = {};
  for (const strategy of state.strategies) {
    const bucket = decisionBucket(strategy.lastDecision);
    funnel[bucket] = (funnel[bucket] ?? 0) + 1;
  }

  const closesLast12h = recentCloses.length;
  const diagnosis = closesLast12h <= 2
    ? "Frecuencia baja confirmada. El sistema descubre el universo EUR, pero solo opera una cohorte fija de estrategias y exige nueva vela cerrada, cruce EMA, RSI compatible, costes aceptables, noticias y controles de riesgo. No se aumentará la frecuencia relajando seguridad: primero se medirá qué puerta bloquea cada oportunidad."
    : "La cohorte PAPER está generando cierres; se mantiene la medición del embudo para separar actividad real de sobreoperación.";

  return {
    schemaVersion: "paper-market-coverage-audit-v1",
    generatedAt: now,
    universeGeneratedAt: universe?.generatedAt ?? null,
    markets: {
      eurDiscovered: universe?.eurMarketsDiscovered ?? null,
      online: universe?.onlineEurMarkets ?? null,
      capitalCompatible: universe?.capitalCompatibleMarkets ?? null,
      eligibleByLane,
    },
    activeRoster: {
      total: state.strategies.length,
      byLane,
      shareOfEligibleByLane: {
        fast: eligibleByLane.fast > 0 ? byLane.fast / eligibleByLane.fast : null,
        intraday: eligibleByLane.intraday > 0 ? byLane.intraday / eligibleByLane.intraday : null,
        swing: eligibleByLane.swing > 0 ? byLane.swing / eligibleByLane.swing : null,
      },
    },
    activity: {
      cycles: state.cycles,
      strategyCycles: state.strategies.reduce((sum, strategy) => sum + strategy.cycles, 0),
      uniqueClosedCandles: state.strategies.reduce((sum, strategy) => sum + strategy.uniqueCandles, 0),
      duplicateCandleSkips: state.strategies.reduce((sum, strategy) => sum + strategy.duplicateSkips, 0),
      errors: state.strategies.reduce((sum, strategy) => sum + strategy.errors, 0),
      openPositions: state.strategies.filter((strategy) => strategy.position !== null).length,
      buysLast12h: recentBuys.length,
      closesLast12h,
      winsLast12h: recentCloses.filter((trade) => (trade.pnlEur ?? 0) > 0).length,
      lossesLast12h: recentCloses.filter((trade) => (trade.pnlEur ?? 0) < 0).length,
    },
    currentDecisionFunnel: funnel,
    diagnosis,
    changesTradingDecision: false,
    liveTrading: false,
  };
}
