import { selectMarketObservation } from "./market-evidence";
import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "./market-universe";
import { PAPER_ROSTER_LIMITS } from "./paper-roster-policy";
import { calculateIndicators } from "./strategy";
import type { Candle, Indicators } from "./types";

export type LabStrategyStatus = "active" | "halted" | "error";
export type LabAction = "buy" | "sell" | "hold";

export interface FastEntryGate {
  checkedAt: number;
  allowed: boolean;
  costPct: number | null;
  blocker: string | null;
}

export interface LabLaneConfig {
  id: ResearchLaneId;
  intervalMinutes: number;
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  buyRsiMinimum: number;
  buyRsiMaximum: number;
  sellRsi: number;
  stopLossPct: number;
  takeProfitPct: number;
  cooldownMinutes: number;
  maximumHoldingMinutes: number;
  feePctEachSide: number;
  slippagePctEachSide: number;
}

export const LAB_LANE_CONFIGS: Record<ResearchLaneId, LabLaneConfig> = {
  fast: {
    id: "fast",
    intervalMinutes: 5,
    fastPeriod: 5,
    slowPeriod: 13,
    rsiPeriod: 7,
    buyRsiMinimum: 46,
    buyRsiMaximum: 62,
    sellRsi: 68,
    stopLossPct: 0.012,
    takeProfitPct: 0.024,
    cooldownMinutes: 20,
    maximumHoldingMinutes: 180,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
  },
  intraday: {
    id: "intraday",
    intervalMinutes: 15,
    fastPeriod: 9,
    slowPeriod: 21,
    rsiPeriod: 14,
    buyRsiMinimum: 48,
    buyRsiMaximum: 65,
    sellRsi: 72,
    stopLossPct: 0.02,
    takeProfitPct: 0.04,
    cooldownMinutes: 60,
    maximumHoldingMinutes: 720,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
  },
  swing: {
    id: "swing",
    intervalMinutes: 60,
    fastPeriod: 12,
    slowPeriod: 26,
    rsiPeriod: 14,
    buyRsiMinimum: 45,
    buyRsiMaximum: 68,
    sellRsi: 75,
    stopLossPct: 0.04,
    takeProfitPct: 0.08,
    cooldownMinutes: 360,
    maximumHoldingMinutes: 14 * 24 * 60,
    feePctEachSide: 0.004,
    slippagePctEachSide: 0.001,
  },
};

export interface LabPosition {
  quantity: number;
  entryPrice: number;
  entryTime: number;
  costEur: number;
  stopLoss: number;
  takeProfit: number;
}

export interface LabTrade {
  id: string;
  side: "buy" | "sell";
  timestamp: number;
  price: number;
  quantity: number;
  grossEur: number;
  feeEur: number;
  reason: string;
  pnlEur?: number;
}

export interface LabPerformance {
  buys: number;
  sells: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  grossProfitEur: number;
  grossLossEur: number;
  netPnlEur: number;
  totalFeesEur: number;
}

export interface LabStrategyState {
  id: string;
  lane: ResearchLaneId;
  pairKey: string;
  symbol: string;
  base: string;
  status: LabStrategyStatus;
  initialCashEur: number;
  cashEur: number;
  equityEur: number;
  peakEquityEur: number;
  maxDrawdownPct: number;
  position: LabPosition | null;
  config: LabLaneConfig;
  estimatedOrderMinimumEur: number;
  estimatedTakerRoundTripCostPct: number;
  lastClosedCandleTime: number | null;
  lastAttemptAt: number | null;
  lastSuccessfulAt: number | null;
  nextDueAt: number;
  lastTradeAt: number | null;
  lastDecision: string;
  cycles: number;
  uniqueCandles: number;
  duplicateSkips: number;
  errors: number;
  consecutiveErrors: number;
  lastError: string | null;
  performance: LabPerformance;
  trades: LabTrade[];
}

export interface ResearchLabState {
  schemaVersion: "multi-horizon-paper-lab-v1";
  version: "0.17.0-paper";
  mode: "paper";
  initializedAt: number;
  cohortLockedUntil: number;
  sourceUniverseGeneratedAt: number;
  lastCycleAt: number | null;
  cycles: number;
  strategies: LabStrategyState[];
  liveTrading: false;
}

export interface LabStrategySummary {
  id: string;
  lane: ResearchLaneId;
  symbol: string;
  status: LabStrategyStatus;
  equityEur: number;
  netReturnPct: number;
  closedTrades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number;
  errorRatePct: number;
  eligibleForHumanReview: boolean;
  lastDecision: string;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyPerformance(): LabPerformance {
  return {
    buys: 0,
    sells: 0,
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    grossProfitEur: 0,
    grossLossEur: 0,
    netPnlEur: 0,
    totalFeesEur: 0,
  };
}

function createStrategy(lane: ResearchLaneId, candidate: MarketCandidate, now: number): LabStrategyState {
  const config = LAB_LANE_CONFIGS[lane];
  return {
    id: `${lane}:${candidate.pairKey}`,
    lane,
    pairKey: candidate.pairKey,
    symbol: candidate.symbol,
    base: candidate.base,
    status: "active",
    initialCashEur: 50,
    cashEur: 50,
    equityEur: 50,
    peakEquityEur: 50,
    maxDrawdownPct: 0,
    position: null,
    config,
    estimatedOrderMinimumEur: candidate.estimatedOrderMinimumEur,
    estimatedTakerRoundTripCostPct: candidate.takerRoundTripCostPct,
    lastClosedCandleTime: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextDueAt: now,
    lastTradeAt: null,
    lastDecision: "Esperando primera vela cerrada",
    cycles: 0,
    uniqueCandles: 0,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: emptyPerformance(),
    trades: [],
  };
}

export function initializeResearchLab(universe: MarketUniverse, now = Date.now()): ResearchLabState {
  const strategies: LabStrategyState[] = [];
  for (const lane of ["fast", "intraday", "swing"] as const) {
    for (const candidate of universe.topByLane[lane].slice(0, PAPER_ROSTER_LIMITS[lane])) {
      strategies.push(createStrategy(lane, candidate, now));
    }
  }

  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    initializedAt: now,
    cohortLockedUntil: now + 14 * 24 * 60 * 60_000,
    sourceUniverseGeneratedAt: universe.generatedAt,
    lastCycleAt: null,
    cycles: 0,
    strategies,
    liveTrading: false,
  };
}

export function isStrategyDue(strategy: LabStrategyState, now = Date.now()): boolean {
  return strategy.status === "active" && now >= strategy.nextDueAt;
}

function decideLab(indicators: Indicators, hasPosition: boolean, config: LabLaneConfig): { action: LabAction; reason: string } {
  const bullishCross = indicators.previousFastEma <= indicators.previousSlowEma
    && indicators.fastEma > indicators.slowEma;
  const bearishCross = indicators.previousFastEma >= indicators.previousSlowEma
    && indicators.fastEma < indicators.slowEma;

  if (!hasPosition && bullishCross && indicators.rsi >= config.buyRsiMinimum && indicators.rsi <= config.buyRsiMaximum) {
    return { action: "buy", reason: "Cruce EMA alcista con RSI compatible con el carril" };
  }
  if (hasPosition && (bearishCross || indicators.rsi >= config.sellRsi)) {
    return { action: "sell", reason: bearishCross ? "Cruce EMA bajista" : "RSI de salida del carril" };
  }
  return { action: "hold", reason: "Sin señal válida para el carril" };
}

function markEquity(strategy: LabStrategyState, currentPrice: number): void {
  strategy.equityEur = money(strategy.cashEur + (strategy.position?.quantity ?? 0) * currentPrice);
  strategy.peakEquityEur = Math.max(strategy.peakEquityEur, strategy.equityEur);
  if (strategy.peakEquityEur > 0) {
    strategy.maxDrawdownPct = Math.max(
      strategy.maxDrawdownPct,
      Math.max(0, (strategy.peakEquityEur - strategy.equityEur) / strategy.peakEquityEur),
    );
  }
}

function addTrade(strategy: LabStrategyState, trade: LabTrade): void {
  strategy.performance.totalFeesEur = money(strategy.performance.totalFeesEur + trade.feeEur);
  if (trade.side === "buy") {
    strategy.performance.buys += 1;
  } else {
    strategy.performance.sells += 1;
    if (typeof trade.pnlEur === "number") {
      strategy.performance.closedTrades += 1;
      strategy.performance.netPnlEur = money(strategy.performance.netPnlEur + trade.pnlEur);
      if (trade.pnlEur > 0) {
        strategy.performance.winningTrades += 1;
        strategy.performance.grossProfitEur = money(strategy.performance.grossProfitEur + trade.pnlEur);
      } else if (trade.pnlEur < 0) {
        strategy.performance.losingTrades += 1;
        strategy.performance.grossLossEur = money(strategy.performance.grossLossEur + Math.abs(trade.pnlEur));
      }
    }
  }
  strategy.trades = [trade, ...strategy.trades].slice(0, 100);
}

function buy(strategy: LabStrategyState, rawPrice: number, now: number, reason: string): void {
  const grossBudget = Math.min(10, strategy.cashEur * 0.2);
  if (strategy.estimatedOrderMinimumEur > grossBudget) {
    strategy.lastDecision = "Compra bloqueada: el mínimo del mercado supera la asignación PAPER";
    return;
  }
  const price = rawPrice * (1 + strategy.config.slippagePctEachSide);
  const feeEur = grossBudget * strategy.config.feePctEachSide;
  const costEur = grossBudget + feeEur;
  if (costEur > strategy.cashEur) {
    strategy.lastDecision = "Compra bloqueada: saldo PAPER insuficiente tras comisiones";
    return;
  }
  const quantity = grossBudget / price;
  strategy.cashEur = money(strategy.cashEur - costEur);
  strategy.position = {
    quantity,
    entryPrice: price,
    entryTime: now,
    costEur,
    stopLoss: price * (1 - strategy.config.stopLossPct),
    takeProfit: price * (1 + strategy.config.takeProfitPct),
  };
  strategy.lastTradeAt = now;
  strategy.lastDecision = `PAPER BUY: ${reason}`;
  addTrade(strategy, {
    id: crypto.randomUUID(),
    side: "buy",
    timestamp: now,
    price,
    quantity,
    grossEur: grossBudget,
    feeEur,
    reason,
  });
}

function sell(strategy: LabStrategyState, rawPrice: number, now: number, reason: string): void {
  const position = strategy.position;
  if (!position) return;
  const price = rawPrice * (1 - strategy.config.slippagePctEachSide);
  const grossEur = position.quantity * price;
  const feeEur = grossEur * strategy.config.feePctEachSide;
  const proceeds = grossEur - feeEur;
  const pnlEur = proceeds - position.costEur;
  strategy.cashEur = money(strategy.cashEur + proceeds);
  strategy.position = null;
  strategy.lastTradeAt = now;
  strategy.lastDecision = `PAPER SELL: ${reason}`;
  addTrade(strategy, {
    id: crypto.randomUUID(),
    side: "sell",
    timestamp: now,
    price,
    quantity: position.quantity,
    grossEur,
    feeEur,
    reason,
    pnlEur,
  });
}

function fastGateBlocker(gate: FastEntryGate | null, now: number): string | null {
  if (!gate) return "evidencia de ejecución no disponible";
  if (now - gate.checkedAt > 10 * 60_000) return "evidencia de ejecución caducada";
  if (!gate.allowed) return gate.blocker ?? "coste o profundidad insuficientes";
  return null;
}

export function applyResearchCandles(
  strategy: LabStrategyState,
  candles: Candle[],
  now = Date.now(),
  fastEntryGate: FastEntryGate | null = null,
): LabStrategyState {
  strategy.lastAttemptAt = now;
  strategy.cycles += 1;
  strategy.nextDueAt = now + strategy.config.intervalMinutes * 60_000;
  const observation = selectMarketObservation(candles, strategy.lastClosedCandleTime);
  markEquity(strategy, observation.currentPrice);

  if (!observation.isNewClosedCandle) {
    strategy.duplicateSkips += 1;
    strategy.lastSuccessfulAt = now;
    strategy.consecutiveErrors = 0;
    strategy.lastError = null;
    strategy.lastDecision = "Sin nueva vela cerrada para este carril";
    return strategy;
  }

  strategy.lastClosedCandleTime = observation.latestClosedCandleTime;
  strategy.uniqueCandles += 1;
  const indicators = calculateIndicators(
    observation.closedCandles,
    strategy.config.fastPeriod,
    strategy.config.slowPeriod,
    strategy.config.rsiPeriod,
  );
  const price = indicators.price;
  const signal = decideLab(indicators, strategy.position !== null, strategy.config);
  const position = strategy.position;

  if (position && price <= position.stopLoss) {
    sell(strategy, price, now, "Stop loss del carril");
  } else if (position && price >= position.takeProfit) {
    sell(strategy, price, now, "Take profit del carril");
  } else if (position && now - position.entryTime >= strategy.config.maximumHoldingMinutes * 60_000) {
    sell(strategy, price, now, "Tiempo máximo de permanencia alcanzado");
  } else if (strategy.maxDrawdownPct >= 0.05) {
    strategy.status = "halted";
    strategy.lastDecision = "Carril detenido por drawdown máximo del 5 %";
  } else if (
    strategy.lastTradeAt !== null
    && now - strategy.lastTradeAt < strategy.config.cooldownMinutes * 60_000
  ) {
    strategy.lastDecision = "Cooldown PAPER del carril";
  } else if (signal.action === "buy") {
    const blocker = strategy.lane === "fast" ? fastGateBlocker(fastEntryGate, now) : null;
    if (blocker) {
      strategy.lastDecision = `Compra rápida vetada por ejecución: ${blocker}`;
    } else {
      buy(strategy, price, now, signal.reason);
    }
  } else if (signal.action === "sell") {
    sell(strategy, price, now, signal.reason);
  } else {
    strategy.lastDecision = signal.reason;
  }

  markEquity(strategy, observation.currentPrice);
  strategy.lastSuccessfulAt = now;
  strategy.consecutiveErrors = 0;
  strategy.lastError = null;
  return strategy;
}

export function recordResearchError(strategy: LabStrategyState, error: unknown, now = Date.now()): void {
  const message = error instanceof Error ? error.message : "Unknown research lab error";
  strategy.lastAttemptAt = now;
  strategy.nextDueAt = now + strategy.config.intervalMinutes * 60_000;
  strategy.errors += 1;
  strategy.consecutiveErrors += 1;
  strategy.lastError = message;
  strategy.lastDecision = `ERROR: ${message}`;
  if (strategy.consecutiveErrors >= 3) strategy.status = "error";
}

export function summarizeStrategy(
  strategy: LabStrategyState,
  now = Date.now(),
  observationStartedAt = now,
): LabStrategySummary {
  const performance = strategy.performance;
  const winRatePct = performance.closedTrades > 0
    ? (performance.winningTrades / performance.closedTrades) * 100
    : null;
  const profitFactor = performance.grossLossEur > 0
    ? performance.grossProfitEur / performance.grossLossEur
    : performance.grossProfitEur > 0 ? Number.POSITIVE_INFINITY : null;
  const totalAttempts = strategy.cycles + strategy.errors;
  const errorRatePct = totalAttempts > 0 ? (strategy.errors / totalAttempts) * 100 : 0;
  const netReturnPct = ((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100;
  const observationDays = Math.max(0, (now - observationStartedAt) / 86_400_000);
  const eligibleForHumanReview = observationDays >= 14
    && performance.closedTrades >= 30
    && performance.netPnlEur > 0
    && (profitFactor ?? 0) >= 1.1
    && strategy.maxDrawdownPct <= 0.05
    && errorRatePct <= 1;

  return {
    id: strategy.id,
    lane: strategy.lane,
    symbol: strategy.symbol,
    status: strategy.status,
    equityEur: strategy.equityEur,
    netReturnPct,
    closedTrades: performance.closedTrades,
    winRatePct,
    profitFactor,
    maxDrawdownPct: strategy.maxDrawdownPct,
    errorRatePct,
    eligibleForHumanReview,
    lastDecision: strategy.lastDecision,
  };
}

export function summarizeResearchLab(state: ResearchLabState, now = Date.now()): Record<string, unknown> {
  const strategies = state.strategies.map((strategy) => summarizeStrategy(strategy, now, state.initializedAt));
  const ranked = [...strategies].sort((left, right) => {
    const evidenceDifference = right.closedTrades - left.closedTrades;
    if (Math.abs(evidenceDifference) >= 5) return evidenceDifference;
    return right.netReturnPct - left.netReturnPct || left.maxDrawdownPct - right.maxDrawdownPct;
  });
  return {
    schemaVersion: state.schemaVersion,
    mode: "paper",
    initializedAt: state.initializedAt,
    cohortLockedUntil: state.cohortLockedUntil,
    cohortLocked: now < state.cohortLockedUntil,
    independentVirtualCapitalPerStrategyEur: 50,
    strategiesAreComparableNotAdditive: true,
    strategyCount: strategies.length,
    activeStrategies: strategies.filter((strategy) => strategy.status === "active").length,
    strategiesByLane: {
      fast: strategies.filter((strategy) => strategy.lane === "fast").length,
      intraday: strategies.filter((strategy) => strategy.lane === "intraday").length,
      swing: strategies.filter((strategy) => strategy.lane === "swing").length,
    },
    totalClosedTrades: strategies.reduce((sum, strategy) => sum + strategy.closedTrades, 0),
    provisionalLeaderboard: ranked,
    eligibleForLiveReview: false,
    liveTrading: false,
    message: "Laboratorio comparativo en PAPER. Las compras rápidas requieren además un libro público reciente y elegible.",
  };
}
