import type { Candle } from "./types";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "./market-universe";
import type { NewsDecisionContext } from "./news-decision-context";
import { interpretChart, type ChartIntelligence } from "./chart-intelligence";
import {
  applyResearchCandles as applyBaseResearchCandles,
  initializeResearchLab as initializeBaseResearchLab,
  isStrategyDue,
  recordResearchError,
  summarizeResearchLab,
  type FastEntryGate,
  type LabStrategyState,
  type ResearchLabState,
} from "./research-lab";

export { isStrategyDue, recordResearchError, summarizeResearchLab, type FastEntryGate, type ResearchLabState };

export interface AppliedIntelligenceContext {
  news: NewsDecisionContext | null;
  chart: ChartIntelligence;
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
  const desired = initializeResearchLab(universe, now);
  const goldStrategies = desired.strategies.filter((strategy) => strategy.base.toUpperCase() === "XAUT");
  const known = new Set(state.strategies.map((strategy) => strategy.id));
  for (const strategy of goldStrategies) if (!known.has(strategy.id)) { state.strategies.push(strategy); known.add(strategy.id); }
  return state;
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

export function applyResearchCandles(strategy: LabStrategyState, candles: Candle[], now = Date.now(), fastEntryGate: FastEntryGate | null = null, news: NewsDecisionContext | null = null): LabStrategyState {
  const cashBefore = strategy.cashEur;
  const buysBefore = strategy.performance.buys;
  const chart = interpretChart(candles);
  const result = applyBaseResearchCandles(strategy, candles, now, fastEntryGate);
  if (result.performance.buys > buysBefore && result.position) resizeLatestPaperBuy(result, cashBefore, { news, chart });
  return result;
}
