import type {
  FastEntryGate,
  LabStrategyState,
  ResearchLabState,
} from "./research-lab";
import type {
  PaperBenchmarkMap,
} from "./strategy-benchmark";

export type ShadowLiveDemoStatus =
  | "initializing"
  | "observing_market"
  | "observing_blocked"
  | "simulated_position_open"
  | "safety_halt"
  | "error";

export interface ShadowLiveDemo {
  schemaVersion: "shadow-live-demo-v1";
  mode: "shadow-live";
  status: ShadowLiveDemoStatus;
  startedAt: number;
  updatedAt: number;
  usesRealKrakenMarketData: true;
  sendsOrdersToKraken: false;
  realBalanceTouched: false;
  virtualCapitalEur: 50;
  selectedStrategy: {
    id: string;
    lane: LabStrategyState["lane"];
    pairKey: string;
    symbol: string;
    intervalMinutes: number;
    strategyStatus: LabStrategyState["status"];
    cashEur: number;
    equityEur: number;
    netPnlEur: number;
    netReturnPct: number;
    maxDrawdownPct: number;
    positionOpen: boolean;
    position: LabStrategyState["position"];
    currentReferencePrice: number | null;
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalFeesEur: number;
    lastDecision: string;
    lastSuccessfulAt: number | null;
    nextDueAt: number;
  };
  executionGate: {
    required: boolean;
    available: boolean;
    fresh: boolean;
    entryAllowed: boolean;
    checkedAt: number | null;
    immediateRoundTripCostPct: number | null;
    blocker: string | null;
  };
  benchmark: {
    available: boolean;
    strategyReturnPct: number;
    benchmarkReturnPct: number | null;
    alphaPct: number | null;
    outperformedBuyAndHold: boolean;
  };
  activity: {
    labCycles: number;
    strategyCycles: number;
    uniqueClosedCandles: number;
    duplicateCandleSkips: number;
    errors: number;
    consecutiveErrors: number;
    tradesRecorded: number;
    latestTrade: LabStrategyState["trades"][number] | null;
  };
  automation: {
    cloudCronMinutes: 5;
    panelRefreshSeconds: 15;
    requiresIphoneOpen: false;
  };
  message: string;
  eligibleForLiveReview: false;
  liveTrading: false;
}

function round(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function strategyReturnPct(strategy: LabStrategyState): number {
  if (strategy.initialCashEur <= 0) return 0;
  return round(((strategy.equityEur - strategy.initialCashEur) / strategy.initialCashEur) * 100);
}

function selectStrategy(
  state: ResearchLabState,
  benchmarks: PaperBenchmarkMap,
): LabStrategyState | null {
  if (state.strategies.length === 0) return null;

  const ranked = [...state.strategies].sort((left, right) => {
    const openDifference = Number(right.position !== null) - Number(left.position !== null);
    if (openDifference !== 0) return openDifference;

    const leftBenchmark = benchmarks[left.id] ?? null;
    const rightBenchmark = benchmarks[right.id] ?? null;
    const leftAlpha = leftBenchmark
      ? strategyReturnPct(left) - leftBenchmark.netReturnPct
      : Number.NEGATIVE_INFINITY;
    const rightAlpha = rightBenchmark
      ? strategyReturnPct(right) - rightBenchmark.netReturnPct
      : Number.NEGATIVE_INFINITY;
    if (rightAlpha !== leftAlpha) return rightAlpha - leftAlpha;

    const activeDifference = Number(right.status === "active") - Number(left.status === "active");
    if (activeDifference !== 0) return activeDifference;

    return right.equityEur - left.equityEur
      || left.maxDrawdownPct - right.maxDrawdownPct
      || left.id.localeCompare(right.id);
  });

  return ranked[0] ?? null;
}

function gateForStrategy(
  strategy: LabStrategyState,
  gates: Record<string, FastEntryGate>,
  now: number,
): ShadowLiveDemo["executionGate"] {
  if (strategy.lane !== "fast") {
    return {
      required: false,
      available: true,
      fresh: true,
      entryAllowed: true,
      checkedAt: null,
      immediateRoundTripCostPct: null,
      blocker: null,
    };
  }

  const gate = gates[strategy.pairKey] ?? null;
  const fresh = gate !== null && now - gate.checkedAt <= 10 * 60_000;
  const entryAllowed = gate !== null && fresh && gate.allowed;
  return {
    required: true,
    available: gate !== null,
    fresh,
    entryAllowed,
    checkedAt: gate?.checkedAt ?? null,
    immediateRoundTripCostPct: gate?.costPct ?? null,
    blocker: gate === null
      ? "execution-evidence-unavailable"
      : !fresh ? "execution-evidence-stale" : gate.blocker,
  };
}

function demoStatus(
  strategy: LabStrategyState,
  gate: ShadowLiveDemo["executionGate"],
): ShadowLiveDemoStatus {
  if (strategy.status === "error") return "error";
  if (strategy.status === "halted") return "safety_halt";
  if (strategy.position !== null) return "simulated_position_open";
  if (gate.required && !gate.entryAllowed) return "observing_blocked";
  return "observing_market";
}

function statusMessage(
  status: ShadowLiveDemoStatus,
  strategy: LabStrategyState,
  gate: ShadowLiveDemo["executionGate"],
): string {
  switch (status) {
    case "simulated_position_open":
      return `Posición DEMO abierta en ${strategy.symbol}. Se aplicarán stop loss, take profit, tiempo máximo y comisiones simuladas.`;
    case "observing_blocked":
      return `Observando ${strategy.symbol}; no abre una compra DEMO porque el veto de ejecución indica: ${gate.blocker ?? "condiciones no favorables"}.`;
    case "safety_halt":
      return `La estrategia DEMO de ${strategy.symbol} está detenida por un límite de seguridad.`;
    case "error":
      return `La estrategia DEMO de ${strategy.symbol} está aislada por errores consecutivos; las demás estrategias continúan.`;
    case "observing_market":
      return `Observando ${strategy.symbol} con precios reales. La próxima operación solo aparecerá cuando exista una señal válida.`;
    default:
      return "Inicializando el modo DEMO con el próximo ciclo automático.";
  }
}

export function buildShadowLiveDemo(
  state: ResearchLabState,
  gates: Record<string, FastEntryGate>,
  benchmarks: PaperBenchmarkMap,
  now = Date.now(),
): ShadowLiveDemo | {
  schemaVersion: "shadow-live-demo-v1";
  mode: "shadow-live";
  status: "initializing";
  startedAt: number;
  updatedAt: number;
  usesRealKrakenMarketData: true;
  sendsOrdersToKraken: false;
  realBalanceTouched: false;
  virtualCapitalEur: 50;
  message: string;
  eligibleForLiveReview: false;
  liveTrading: false;
} {
  const strategy = selectStrategy(state, benchmarks);
  if (!strategy) {
    return {
      schemaVersion: "shadow-live-demo-v1",
      mode: "shadow-live",
      status: "initializing",
      startedAt: state.initializedAt,
      updatedAt: now,
      usesRealKrakenMarketData: true,
      sendsOrdersToKraken: false,
      realBalanceTouched: false,
      virtualCapitalEur: 50,
      message: "El DEMO se inicializará cuando exista al menos una estrategia PAPER válida.",
      eligibleForLiveReview: false,
      liveTrading: false,
    };
  }

  const gate = gateForStrategy(strategy, gates, now);
  const benchmark = benchmarks[strategy.id] ?? null;
  const strategyPct = strategyReturnPct(strategy);
  const benchmarkPct = benchmark?.netReturnPct ?? null;
  const alphaPct = benchmarkPct === null ? null : round(strategyPct - benchmarkPct);
  const status = demoStatus(strategy, gate);

  return {
    schemaVersion: "shadow-live-demo-v1",
    mode: "shadow-live",
    status,
    startedAt: state.initializedAt,
    updatedAt: now,
    usesRealKrakenMarketData: true,
    sendsOrdersToKraken: false,
    realBalanceTouched: false,
    virtualCapitalEur: 50,
    selectedStrategy: {
      id: strategy.id,
      lane: strategy.lane,
      pairKey: strategy.pairKey,
      symbol: strategy.symbol,
      intervalMinutes: strategy.config.intervalMinutes,
      strategyStatus: strategy.status,
      cashEur: strategy.cashEur,
      equityEur: strategy.equityEur,
      netPnlEur: round(strategy.equityEur - strategy.initialCashEur),
      netReturnPct: strategyPct,
      maxDrawdownPct: strategy.maxDrawdownPct,
      positionOpen: strategy.position !== null,
      position: strategy.position,
      currentReferencePrice: benchmark?.currentRawPrice ?? null,
      closedTrades: strategy.performance.closedTrades,
      winningTrades: strategy.performance.winningTrades,
      losingTrades: strategy.performance.losingTrades,
      totalFeesEur: strategy.performance.totalFeesEur,
      lastDecision: strategy.lastDecision,
      lastSuccessfulAt: strategy.lastSuccessfulAt,
      nextDueAt: strategy.nextDueAt,
    },
    executionGate: gate,
    benchmark: {
      available: benchmark !== null,
      strategyReturnPct: strategyPct,
      benchmarkReturnPct: benchmarkPct,
      alphaPct,
      outperformedBuyAndHold: alphaPct !== null && alphaPct > 0,
    },
    activity: {
      labCycles: state.cycles,
      strategyCycles: strategy.cycles,
      uniqueClosedCandles: strategy.uniqueCandles,
      duplicateCandleSkips: strategy.duplicateSkips,
      errors: strategy.errors,
      consecutiveErrors: strategy.consecutiveErrors,
      tradesRecorded: strategy.trades.length,
      latestTrade: strategy.trades[0] ?? null,
    },
    automation: {
      cloudCronMinutes: 5,
      panelRefreshSeconds: 15,
      requiresIphoneOpen: false,
    },
    message: statusMessage(status, strategy, gate),
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
