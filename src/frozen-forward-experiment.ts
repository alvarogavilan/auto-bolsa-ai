import type { StrategyBenchmarkSuite } from "./benchmark-suite";
import type { LabStrategyState } from "./research-lab";

export interface FrozenStrategyAccumulator {
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  baselineEquityEur: number;
  baselineBuyHoldReturnPct: number | null;
  pendingBaselinePositionExit: boolean;
  forwardClosedTrades: number;
  forwardWinningTrades: number;
  forwardLosingTrades: number;
  forwardNetPnlEur: number;
}

export interface FrozenForwardExperimentState {
  schemaVersion: "frozen-forward-experiment-state-v1";
  initializedAt: number;
  updatedAt: number;
  manifestHash: string;
  manifestJson: string;
  configurationDriftDetected: boolean;
  firstDriftDetectedAt: number | null;
  seenTradeIds: string[];
  strategies: Record<string, FrozenStrategyAccumulator>;
  changesTradingDecision: false;
  liveTrading: false;
}

export interface FrozenForwardStrategyReport extends FrozenStrategyAccumulator {
  currentEquityEur: number;
  strategyReturnDeltaPct: number;
  currentBuyHoldReturnPct: number | null;
  buyHoldReturnDeltaPct: number | null;
  bestPassiveReturnDeltaPct: number;
  alphaVsBestPassivePct: number;
  outperformedBestPassive: boolean;
}

export interface FrozenForwardExperimentReport {
  schemaVersion: "frozen-forward-experiment-report-v1";
  generatedAt: number;
  initializedAt: number;
  forwardDays: number;
  manifestHash: string;
  currentManifestHash: string;
  parametersFrozen: boolean;
  configurationDriftDetected: boolean;
  firstDriftDetectedAt: number | null;
  strategyCount: number;
  forwardClosedTrades: number;
  strategiesWithPositiveForwardPnl: number;
  strategiesOutperformingBestPassive: number;
  researchReviewCandidate: boolean;
  researchReviewBlockers: string[];
  strategies: FrozenForwardStrategyReport[];
  methodology: string;
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

const MAX_SEEN_TRADE_IDS = 20_000;

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return finite(value) && value >= 0 && Number.isInteger(value);
}

function lane(value: unknown): value is LabStrategyState["lane"] {
  return value === "fast" || value === "intraday" || value === "swing";
}

function benchmarkMap(suite: StrategyBenchmarkSuite | null): Map<string, number | null> {
  return new Map((suite?.entries ?? []).map((entry) => [entry.strategyId, entry.buyHoldReturnPct]));
}

function manifestObject(strategies: LabStrategyState[]): unknown[] {
  return [...strategies]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((strategy) => ({
      id: strategy.id,
      lane: strategy.lane,
      pairKey: strategy.pairKey,
      symbol: strategy.symbol,
      initialCashEur: strategy.initialCashEur,
      config: {
        intervalMinutes: strategy.config.intervalMinutes,
        fastPeriod: strategy.config.fastPeriod,
        slowPeriod: strategy.config.slowPeriod,
        rsiPeriod: strategy.config.rsiPeriod,
        buyRsiMinimum: strategy.config.buyRsiMinimum,
        buyRsiMaximum: strategy.config.buyRsiMaximum,
        sellRsi: strategy.config.sellRsi,
        stopLossPct: strategy.config.stopLossPct,
        takeProfitPct: strategy.config.takeProfitPct,
        cooldownMinutes: strategy.config.cooldownMinutes,
        maximumHoldingMinutes: strategy.config.maximumHoldingMinutes,
        feePctEachSide: strategy.config.feePctEachSide,
        slippagePctEachSide: strategy.config.slippagePctEachSide,
      },
    }));
}

export function buildFrozenManifestJson(strategies: LabStrategyState[]): string {
  return JSON.stringify(manifestObject(strategies));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function frozenManifestHash(strategies: LabStrategyState[]): Promise<string> {
  return sha256Hex(buildFrozenManifestJson(strategies));
}

export async function createFrozenForwardExperiment(
  strategies: LabStrategyState[],
  suite: StrategyBenchmarkSuite | null,
  now = Date.now(),
): Promise<FrozenForwardExperimentState> {
  const benchmarks = benchmarkMap(suite);
  const manifestJson = buildFrozenManifestJson(strategies);
  const manifestHash = await sha256Hex(manifestJson);
  const seenTradeIds = strategies.flatMap((strategy) => strategy.trades.map((trade) => trade.id));
  const accumulators = Object.fromEntries(strategies.map((strategy) => [strategy.id, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    lane: strategy.lane,
    baselineEquityEur: strategy.equityEur,
    baselineBuyHoldReturnPct: benchmarks.get(strategy.id) ?? null,
    pendingBaselinePositionExit: strategy.position !== null,
    forwardClosedTrades: 0,
    forwardWinningTrades: 0,
    forwardLosingTrades: 0,
    forwardNetPnlEur: 0,
  } satisfies FrozenStrategyAccumulator]));

  return {
    schemaVersion: "frozen-forward-experiment-state-v1",
    initializedAt: now,
    updatedAt: now,
    manifestHash,
    manifestJson,
    configurationDriftDetected: false,
    firstDriftDetectedAt: null,
    seenTradeIds: [...new Set(seenTradeIds)].slice(-MAX_SEEN_TRADE_IDS),
    strategies: accumulators,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

function sanitizeAccumulator(key: string, value: unknown): FrozenStrategyAccumulator | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<FrozenStrategyAccumulator>;
  if (
    item.strategyId !== key
    || typeof item.symbol !== "string"
    || !lane(item.lane)
    || !finite(item.baselineEquityEur)
    || item.baselineEquityEur <= 0
    || !(item.baselineBuyHoldReturnPct === null || finite(item.baselineBuyHoldReturnPct))
    || typeof item.pendingBaselinePositionExit !== "boolean"
    || !nonNegativeInteger(item.forwardClosedTrades)
    || !nonNegativeInteger(item.forwardWinningTrades)
    || !nonNegativeInteger(item.forwardLosingTrades)
    || !finite(item.forwardNetPnlEur)
    || item.forwardWinningTrades + item.forwardLosingTrades > item.forwardClosedTrades
  ) return null;
  return {
    strategyId: item.strategyId,
    symbol: item.symbol,
    lane: item.lane,
    baselineEquityEur: item.baselineEquityEur,
    baselineBuyHoldReturnPct: item.baselineBuyHoldReturnPct,
    pendingBaselinePositionExit: item.pendingBaselinePositionExit,
    forwardClosedTrades: item.forwardClosedTrades,
    forwardWinningTrades: item.forwardWinningTrades,
    forwardLosingTrades: item.forwardLosingTrades,
    forwardNetPnlEur: item.forwardNetPnlEur,
  };
}

export function sanitizeFrozenForwardExperiment(value: unknown): FrozenForwardExperimentState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<FrozenForwardExperimentState>;
  if (
    candidate.schemaVersion !== "frozen-forward-experiment-state-v1"
    || !finite(candidate.initializedAt)
    || !finite(candidate.updatedAt)
    || typeof candidate.manifestHash !== "string"
    || candidate.manifestHash.length !== 64
    || typeof candidate.manifestJson !== "string"
    || typeof candidate.configurationDriftDetected !== "boolean"
    || !(candidate.firstDriftDetectedAt === null || finite(candidate.firstDriftDetectedAt))
    || !candidate.strategies
    || typeof candidate.strategies !== "object"
    || Array.isArray(candidate.strategies)
  ) return null;

  const strategies: Record<string, FrozenStrategyAccumulator> = {};
  for (const [key, raw] of Object.entries(candidate.strategies)) {
    const accumulator = sanitizeAccumulator(key, raw);
    if (!accumulator) return null;
    strategies[key] = accumulator;
  }

  return {
    schemaVersion: "frozen-forward-experiment-state-v1",
    initializedAt: candidate.initializedAt,
    updatedAt: candidate.updatedAt,
    manifestHash: candidate.manifestHash,
    manifestJson: candidate.manifestJson,
    configurationDriftDetected: candidate.configurationDriftDetected,
    firstDriftDetectedAt: candidate.firstDriftDetectedAt,
    seenTradeIds: Array.isArray(candidate.seenTradeIds)
      ? candidate.seenTradeIds.filter((item): item is string => typeof item === "string").slice(-MAX_SEEN_TRADE_IDS)
      : [],
    strategies,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

function processNewTrades(
  state: FrozenForwardExperimentState,
  strategies: LabStrategyState[],
): FrozenForwardExperimentState {
  const seen = new Set(state.seenTradeIds);
  const accumulators = Object.fromEntries(
    Object.entries(state.strategies).map(([id, accumulator]) => [id, { ...accumulator }]),
  );

  for (const strategy of strategies) {
    const accumulator = accumulators[strategy.id];
    if (!accumulator) continue;
    const trades = [...strategy.trades].sort((left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
    for (const trade of trades) {
      if (seen.has(trade.id)) continue;
      seen.add(trade.id);
      if (trade.side !== "sell" || typeof trade.pnlEur !== "number" || !Number.isFinite(trade.pnlEur)) continue;
      if (accumulator.pendingBaselinePositionExit) {
        accumulator.pendingBaselinePositionExit = false;
        continue;
      }
      accumulator.forwardClosedTrades += 1;
      accumulator.forwardNetPnlEur = round(accumulator.forwardNetPnlEur + trade.pnlEur);
      if (trade.pnlEur > 0) accumulator.forwardWinningTrades += 1;
      if (trade.pnlEur < 0) accumulator.forwardLosingTrades += 1;
    }
  }
  return {
    ...state,
    seenTradeIds: [...seen].slice(-MAX_SEEN_TRADE_IDS),
    strategies: accumulators,
  };
}

export async function advanceFrozenForwardExperiment(
  current: FrozenForwardExperimentState | null,
  strategies: LabStrategyState[],
  suite: StrategyBenchmarkSuite | null,
  now = Date.now(),
): Promise<{ state: FrozenForwardExperimentState; report: FrozenForwardExperimentReport }> {
  let state = current ?? await createFrozenForwardExperiment(strategies, suite, now);
  const currentManifestHash = await frozenManifestHash(strategies);
  const driftNow = currentManifestHash !== state.manifestHash;
  state = processNewTrades(state, strategies);
  state = {
    ...state,
    updatedAt: now,
    configurationDriftDetected: state.configurationDriftDetected || driftNow,
    firstDriftDetectedAt: state.firstDriftDetectedAt ?? (driftNow ? now : null),
    changesTradingDecision: false,
    liveTrading: false,
  };
  return { state, report: buildFrozenForwardReport(state, strategies, suite, currentManifestHash, now) };
}

export function buildFrozenForwardReport(
  state: FrozenForwardExperimentState,
  strategies: LabStrategyState[],
  suite: StrategyBenchmarkSuite | null,
  currentManifestHash: string,
  now = Date.now(),
): FrozenForwardExperimentReport {
  const benchmarkById = benchmarkMap(suite);
  const currentById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const strategyReports = Object.values(state.strategies)
    .sort((left, right) => left.strategyId.localeCompare(right.strategyId))
    .map((accumulator): FrozenForwardStrategyReport => {
      const strategy = currentById.get(accumulator.strategyId);
      const currentEquityEur = strategy?.equityEur ?? accumulator.baselineEquityEur;
      const strategyReturnDeltaPct = accumulator.baselineEquityEur > 0
        ? round(((currentEquityEur - accumulator.baselineEquityEur) / accumulator.baselineEquityEur) * 100)
        : 0;
      const currentBuyHoldReturnPct = benchmarkById.get(accumulator.strategyId) ?? null;
      const buyHoldReturnDeltaPct = currentBuyHoldReturnPct === null || accumulator.baselineBuyHoldReturnPct === null
        ? null
        : round(currentBuyHoldReturnPct - accumulator.baselineBuyHoldReturnPct);
      const bestPassiveReturnDeltaPct = Math.max(0, buyHoldReturnDeltaPct ?? 0);
      const alphaVsBestPassivePct = round(strategyReturnDeltaPct - bestPassiveReturnDeltaPct);
      return {
        ...accumulator,
        currentEquityEur,
        strategyReturnDeltaPct,
        currentBuyHoldReturnPct,
        buyHoldReturnDeltaPct,
        bestPassiveReturnDeltaPct,
        alphaVsBestPassivePct,
        outperformedBestPassive: alphaVsBestPassivePct > 0,
      };
    });

  const forwardDays = Math.max(0, (now - state.initializedAt) / 86_400_000);
  const forwardClosedTrades = strategyReports.reduce((sum, strategy) => sum + strategy.forwardClosedTrades, 0);
  const positive = strategyReports.filter((strategy) => strategy.forwardNetPnlEur > 0).length;
  const outperforming = strategyReports.filter((strategy) => strategy.outperformedBestPassive).length;
  const blockers: string[] = [];
  if (strategyReports.length === 0) blockers.push("El experimento no contiene estrategias congeladas.");
  if (state.configurationDriftDetected) blockers.push("Los parámetros o la cohorte de mercados cambiaron durante el experimento.");
  if (forwardDays < 14) blockers.push("Aún no han transcurrido 14 días forward con parámetros congelados.");
  if (forwardClosedTrades < 30) blockers.push("Aún no hay 30 operaciones cerradas posteriores a la congelación.");
  if (positive === 0) blockers.push("Ninguna estrategia presenta PnL forward positivo.");
  if (outperforming === 0) blockers.push("Ninguna estrategia supera la mejor alternativa pasiva en el periodo forward.");

  return {
    schemaVersion: "frozen-forward-experiment-report-v1",
    generatedAt: now,
    initializedAt: state.initializedAt,
    forwardDays: round(forwardDays),
    manifestHash: state.manifestHash,
    currentManifestHash,
    parametersFrozen: !state.configurationDriftDetected,
    configurationDriftDetected: state.configurationDriftDetected,
    firstDriftDetectedAt: state.firstDriftDetectedAt,
    strategyCount: strategyReports.length,
    forwardClosedTrades,
    strategiesWithPositiveForwardPnl: positive,
    strategiesOutperformingBestPassive: outperforming,
    researchReviewCandidate: blockers.length === 0,
    researchReviewBlockers: blockers,
    strategies: strategyReports,
    methodology: "Experimento forward puro: la línea base excluye todo historial previo, congela una huella SHA-256 de la cohorte y sus parámetros, ignora el cierre de posiciones ya abiertas al congelar y solo cuenta operaciones completas posteriores. Cualquier deriva invalida la cohorte para revisión.",
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
