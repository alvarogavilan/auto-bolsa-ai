import type { Candle } from "./types";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "./market-universe";
import type { NewsDecisionContext } from "./news-decision-context";
import { interpretChart, type ChartIntelligence } from "./chart-intelligence";
import { reconcileResearchLabRoster } from "./research-lab-roster-reconciliation";
import {
  applyResearchCandles as applyBaseResearchCandles,
  initializeResearchLab as initializeBaseResearchLab,
  isStrategyDue,
  recordResearchError,
  summarizeResearchLab,
  type FastEntryGate,
  type LabPerformance,
  type LabPosition,
  type LabStrategyState,
  type LabTrade,
  type ResearchLabState,
} from "./research-lab";

export { isStrategyDue, recordResearchError, summarizeResearchLab, type FastEntryGate, type ResearchLabState };

export interface AppliedIntelligenceContext {
  news: NewsDecisionContext | null;
  chart: ChartIntelligence;
}

interface FinancialSnapshot {
  cashEur: number;
  equityEur: number;
  peakEquityEur: number;
  maxDrawdownPct: number;
  position: LabPosition | null;
  lastTradeAt: number | null;
  performance: LabPerformance;
  trades: LabTrade[];
}

function isTokenizedGold(candidate: MarketCandidate): boolean {
  const symbol = candidate.symbol.toUpperCase();
  const base = candidate.base.toUpperCase();
  return base === "XAUT" || symbol.startsWith("XAUT/") || symbol.startsWith("XAUT");
}

function withTokenizedGold(universe: MarketUniverse): MarketUniverse {
  const gold = universe.candidates.find((candidate) => isTokenizedGold(candidate) && candidate.status === "online" && candidate.capitalFit && (candidate.intradayEligible || candidate.swingEligible));
  if (!gold) return universe;
  const prependUnique = (items: MarketCandidate[], candidate: MarketCandidate): MarketCandidate[] => [candidate, ...items.filter((item) => item.pairKey !== candidate.pairKey)];
  return {
    ...universe,
    topByLane: {
      ...universe.topByLane,
      intraday: gold.intradayEligible ? prependUnique(universe.topByLane.intraday, gold) : universe.topByLane.intraday,
      swing: gold.swingEligible ? prependUnique(universe.topByLane.swing, gold) : universe.topByLane.swing,
    },
    opportunityMap: [{ route: "tokenized-gold-xaut-eur", status: "research-now", reason: "XAUT/EUR se estudia exclusivamente en PAPER cuando supera mínimos, liquidez, spread y recorrido frente a costes." }, ...universe.opportunityMap.filter((item) => item.route !== "tokenized-gold-xaut-eur")],
    liveTrading: false,
  };
}

export function initializeResearchLab(universe: MarketUniverse, now = Date.now()): ResearchLabState {
  return initializeBaseResearchLab(withTokenizedGold(universe), now);
}

export function reconcileResearchLab(state: ResearchLabState, universe: MarketUniverse, now = Date.now()): ResearchLabState {
  const adaptedUniverse = withTokenizedGold(universe);
  return reconcileResearchLabRoster(state, adaptedUniverse, now).state;
}

function laneMaximumAllocation(lane: ResearchLaneId): number {
  if (lane === "fast") return 0.08;
  if (lane === "intraday") return 0.14;
  return 0.2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function recentClosedTrades(strategy: LabStrategyState, maximum = 12) {
  return strategy.trades
    .filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number")
    .slice(0, maximum);
}

export function paperLossRecoveryBlocker(
  strategy: LabStrategyState,
  intelligence: AppliedIntelligenceContext,
): string | null {
  const recent = recentClosedTrades(strategy, 12);
  if (recent.length < 4) return null;

  const wins = recent.filter((trade) => (trade.pnlEur ?? 0) > 0).length;
  const consecutiveLosses = recent.findIndex((trade) => (trade.pnlEur ?? 0) > 0);
  const losingStreak = consecutiveLosses === -1 ? recent.length : consecutiveLosses;
  if (losingStreak < 4) return null;

  const expectedMove = Math.max(strategy.config.takeProfitPct, 0.0001);
  const costRatio = strategy.estimatedTakerRoundTripCostPct / expectedMove;
  const bullishChart = intelligence.chart.trend === "bullish";
  const strongChart = intelligence.chart.sizeFactor >= (losingStreak >= 8 && wins === 0 ? 1.05 : 0.95);
  const exceptionalCosts = costRatio <= (losingStreak >= 8 && wins === 0 ? 0.3 : 0.45);
  const newsSafe = intelligence.news?.vetoNewLong !== true;

  if (bullishChart && strongChart && exceptionalCosts && newsSafe) return null;
  return `modo recuperación tras ${losingStreak} pérdidas consecutivas: exige tendencia alcista fuerte, costes muy inferiores al objetivo y ausencia de veto informativo`;
}

function adaptivePaperBudget(strategy: LabStrategyState, cashBefore: number, intelligence: AppliedIntelligenceContext): {
  budget: number; allocationPct: number; riskBudgetEur: number; evidenceFactor: number; costFactor: number; intelligenceFactor: number;
} {
  const equity = Math.max(0, cashBefore);
  const maximumAllocation = equity * laneMaximumAllocation(strategy.lane);
  const accountRiskPct = strategy.lane === "fast" ? 0.0025 : strategy.lane === "intraday" ? 0.004 : 0.005;
  const riskBudgetEur = equity * accountRiskPct;
  const stopBasedMaximum = strategy.config.stopLossPct > 0 ? riskBudgetEur / strategy.config.stopLossPct : maximumAllocation;
  const recentClosed = recentClosedTrades(strategy, 12);
  const recentNet = recentClosed.reduce((sum, trade) => sum + (trade.pnlEur ?? 0), 0);
  const recentWins = recentClosed.filter((trade) => (trade.pnlEur ?? 0) > 0).length;
  const evidenceFactor = recentClosed.length < 4 ? 0.72 : recentWins === 0 ? 0.35 : recentNet > 0 ? 1 : recentNet === 0 ? 0.75 : 0.55;
  const expectedMove = Math.max(strategy.config.takeProfitPct, 0.0001);
  const costRatio = strategy.estimatedTakerRoundTripCostPct / expectedMove;
  const costFactor = clamp(1 - costRatio * 0.65, 0.45, 1);
  const drawdownFactor = clamp(1 - strategy.maxDrawdownPct * 8, 0.5, 1);
  const newsFactor = intelligence.news?.sizeFactor ?? 0.8;
  const intelligenceFactor = clamp(newsFactor * intelligence.chart.sizeFactor, 0, 1.15);
  const rawBudget = Math.min(maximumAllocation, stopBasedMaximum) * evidenceFactor * costFactor * drawdownFactor * intelligenceFactor;
  const affordable = cashBefore / (1 + strategy.config.feePctEachSide);
  const minimum = intelligenceFactor === 0 ? 0 : Math.min(affordable, strategy.estimatedOrderMinimumEur);
  const budget = intelligenceFactor === 0 ? 0 : clamp(rawBudget, minimum, Math.min(affordable, maximumAllocation));
  return { budget, allocationPct: equity > 0 ? budget / equity : 0, riskBudgetEur, evidenceFactor, costFactor, intelligenceFactor };
}

function resizeLatestPaperBuy(strategy: LabStrategyState, cashBefore: number, intelligence: AppliedIntelligenceContext): void {
  const position = strategy.position;
  const latest = strategy.trades[0];
  if (!position || !latest || latest.side !== "buy") return;
  const recoveryBlocker = paperLossRecoveryBlocker(strategy, intelligence);
  const sizing = adaptivePaperBudget(strategy, cashBefore, intelligence);
  const originalGross = latest.grossEur;
  if (recoveryBlocker || sizing.budget <= 0 || intelligence.news?.vetoNewLong || intelligence.chart.vetoNewLong) {
    strategy.cashEur = cashBefore;
    strategy.position = null;
    strategy.trades.shift();
    strategy.performance.buys = Math.max(0, strategy.performance.buys - 1);
    strategy.performance.totalFeesEur = Math.max(0, strategy.performance.totalFeesEur - originalGross * strategy.config.feePctEachSide);
    strategy.equityEur = cashBefore;
    strategy.lastDecision = recoveryBlocker
      ? `PAPER BUY vetada por ${recoveryBlocker}.`
      : `PAPER BUY vetada por inteligencia: noticias=${intelligence.news?.vetoNewLong ?? false}; gráfica=${intelligence.chart.vetoNewLong}.`;
    return;
  }
  if (!Number.isFinite(sizing.budget) || Math.abs(sizing.budget - originalGross) < 0.000001) return;
  const fee = sizing.budget * strategy.config.feePctEachSide;
  const cost = sizing.budget + fee;
  if (cost > cashBefore) return;
  const quantity = sizing.budget / latest.price;
  strategy.cashEur = Math.round((cashBefore - cost) * 1_000_000) / 1_000_000;
  strategy.position = { ...position, quantity, costEur: cost };
  latest.quantity = quantity;
  latest.grossEur = sizing.budget;
  latest.feeEur = fee;
  latest.reason = `${latest.reason}. Asignación PAPER adaptativa ${(sizing.allocationPct * 100).toFixed(1)} %; riesgo ${sizing.riskBudgetEur.toFixed(4)} €; evidencia ${(sizing.evidenceFactor * 100).toFixed(0)} %; costes ${(sizing.costFactor * 100).toFixed(0)} %; noticias+gráfica ${(sizing.intelligenceFactor * 100).toFixed(0)} %. Tendencia ${intelligence.chart.trend}; señales noticia ${intelligence.news?.relevantSignals ?? 0}.`;
  strategy.performance.totalFeesEur = Math.round((strategy.performance.totalFeesEur - originalGross * strategy.config.feePctEachSide + fee) * 1_000_000) / 1_000_000;
  strategy.equityEur = Math.round((strategy.cashEur + quantity * latest.price) * 1_000_000) / 1_000_000;
  strategy.lastDecision = `PAPER BUY dimensionada por comité: ${latest.reason}`;
}

function snapshotFinancialState(strategy: LabStrategyState): FinancialSnapshot {
  return {
    cashEur: strategy.cashEur,
    equityEur: strategy.equityEur,
    peakEquityEur: strategy.peakEquityEur,
    maxDrawdownPct: strategy.maxDrawdownPct,
    position: strategy.position ? { ...strategy.position } : null,
    lastTradeAt: strategy.lastTradeAt,
    performance: { ...strategy.performance },
    trades: strategy.trades.map((trade) => ({ ...trade })),
  };
}

function minimumDiscretionaryNetExitPct(strategy: LabStrategyState): number {
  const laneFloor = strategy.lane === "fast" ? 0.006 : strategy.lane === "intraday" ? 0.01 : 0.015;
  return Math.max(laneFloor, strategy.estimatedTakerRoundTripCostPct * 1.5);
}

function restoreTinyRsiExit(strategy: LabStrategyState, before: FinancialSnapshot, currentPrice: number): boolean {
  const latest = strategy.trades[0];
  const position = before.position;
  if (!position || !latest || latest.side !== "sell" || latest.reason !== "RSI de salida del carril") return false;
  const pnl = latest.pnlEur;
  if (typeof pnl !== "number" || pnl <= 0 || position.costEur <= 0) return false;
  const netReturnPct = pnl / position.costEur;
  const minimum = minimumDiscretionaryNetExitPct(strategy);
  if (netReturnPct >= minimum) return false;

  strategy.cashEur = before.cashEur;
  strategy.position = { ...position };
  strategy.lastTradeAt = before.lastTradeAt;
  strategy.performance = { ...before.performance };
  strategy.trades = before.trades.map((trade) => ({ ...trade }));
  strategy.peakEquityEur = before.peakEquityEur;
  strategy.maxDrawdownPct = before.maxDrawdownPct;
  strategy.equityEur = Math.round((before.cashEur + position.quantity * currentPrice) * 1_000_000) / 1_000_000;
  strategy.lastDecision = `Salida RSI aplazada: beneficio neto ${(netReturnPct * 100).toFixed(3)} % inferior al mínimo ${(minimum * 100).toFixed(2)} % exigido tras costes. Stop, take profit, cruce bajista y tiempo máximo siguen activos.`;
  return true;
}

export function applyResearchCandles(strategy: LabStrategyState, candles: Candle[], now = Date.now(), fastEntryGate: FastEntryGate | null = null, news: NewsDecisionContext | null = null): LabStrategyState {
  const cashBefore = strategy.cashEur;
  const buysBefore = strategy.performance.buys;
  const financialBefore = snapshotFinancialState(strategy);
  const chart = interpretChart(candles);
  const result = applyBaseResearchCandles(strategy, candles, now, fastEntryGate);
  const currentPrice = candles.at(-1)?.close;
  if (typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0) {
    restoreTinyRsiExit(result, financialBefore, currentPrice);
  }
  if (result.performance.buys > buysBefore && result.position) resizeLatestPaperBuy(result, cashBefore, { news, chart });
  return result;
}
