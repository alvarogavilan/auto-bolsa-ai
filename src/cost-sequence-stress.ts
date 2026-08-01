import type { LabStrategyState } from "./research-lab";

export type StressVerdict = "insufficient" | "fragile" | "developing" | "resilient_candidate";

export interface ClosedRoundTrip {
  entryTradeId: string;
  exitTradeId: string;
  entryAt: number;
  exitAt: number;
  observedPnlEur: number;
  observedFeesEur: number;
  notionalEur: number;
}

export interface StressScenarioMetrics {
  id: "observed" | "fees_25" | "fees_50" | "fees_100" | "adverse_fill" | "combined";
  label: string;
  feeMultiplier: number;
  extraRoundTripCostPct: number;
  trades: number;
  netPnlEur: number;
  grossProfitEur: number;
  grossLossEur: number;
  profitFactor: number | null;
  profitFactorNoLosses: boolean;
  winRatePct: number | null;
  maxDrawdownEur: number;
  maxDrawdownPct: number;
  longestLosingStreak: number;
  worstFiveTradePnlEur: number | null;
  profitable: boolean;
}

export interface StrategyStressReport {
  schemaVersion: "paper-cost-sequence-stress-entry-v1";
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  closedRoundTrips: number;
  unmatchedBuys: number;
  unmatchedSells: number;
  scenarios: StressScenarioMetrics[];
  observedScenario: StressScenarioMetrics;
  combinedScenario: StressScenarioMetrics;
  verdict: StressVerdict;
  blockers: string[];
  warnings: string[];
  interpretation: string;
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export interface CostSequenceStressReport {
  schemaVersion: "paper-cost-sequence-stress-report-v1";
  methodology: string;
  strategyCount: number;
  sufficientlySampledStrategies: number;
  resilientCandidates: number;
  developingStrategies: number;
  fragileStrategies: number;
  insufficientStrategies: number;
  entries: StrategyStressReport[];
  leaderboard: StrategyStressReport[];
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

interface ScenarioDefinition {
  id: StressScenarioMetrics["id"];
  label: string;
  feeMultiplier: number;
  extraRoundTripCostPct: number;
}

const MINIMUM_ROUND_TRIPS = 30;
const SCENARIOS: ScenarioDefinition[] = [
  { id: "observed", label: "Coste observado", feeMultiplier: 1, extraRoundTripCostPct: 0 },
  { id: "fees_25", label: "Comisiones +25 %", feeMultiplier: 1.25, extraRoundTripCostPct: 0 },
  { id: "fees_50", label: "Comisiones +50 %", feeMultiplier: 1.5, extraRoundTripCostPct: 0 },
  { id: "fees_100", label: "Comisiones x2", feeMultiplier: 2, extraRoundTripCostPct: 0 },
  { id: "adverse_fill", label: "Relleno adverso +0,10 %", feeMultiplier: 1, extraRoundTripCostPct: 0.001 },
  { id: "combined", label: "Comisiones +50 % y relleno +0,10 %", feeMultiplier: 1.5, extraRoundTripCostPct: 0.001 },
];

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pairRoundTrips(strategy: LabStrategyState): {
  roundTrips: ClosedRoundTrip[];
  unmatchedBuys: number;
  unmatchedSells: number;
} {
  const chronological = [...strategy.trades].sort((left, right) =>
    left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const openBuys: LabStrategyState["trades"] = [];
  const roundTrips: ClosedRoundTrip[] = [];
  let unmatchedSells = 0;

  for (const trade of chronological) {
    if (trade.side === "buy") {
      openBuys.push(trade);
      continue;
    }
    if (typeof trade.pnlEur !== "number" || !Number.isFinite(trade.pnlEur)) continue;
    const buy = openBuys.shift();
    if (!buy) {
      unmatchedSells += 1;
      continue;
    }
    const notional = Number.isFinite(buy.grossEur) && buy.grossEur > 0
      ? buy.grossEur
      : Math.max(0, trade.grossEur);
    roundTrips.push({
      entryTradeId: buy.id,
      exitTradeId: trade.id,
      entryAt: buy.timestamp,
      exitAt: trade.timestamp,
      observedPnlEur: round(trade.pnlEur),
      observedFeesEur: round(Math.max(0, buy.feeEur) + Math.max(0, trade.feeEur)),
      notionalEur: round(notional),
    });
  }

  return { roundTrips, unmatchedBuys: openBuys.length, unmatchedSells };
}

function stressedPnl(roundTrip: ClosedRoundTrip, definition: ScenarioDefinition): number {
  const extraFees = roundTrip.observedFeesEur * Math.max(0, definition.feeMultiplier - 1);
  const extraFillCost = roundTrip.notionalEur * Math.max(0, definition.extraRoundTripCostPct);
  return round(roundTrip.observedPnlEur - extraFees - extraFillCost);
}

function worstWindow(pnls: number[], size: number): number | null {
  if (pnls.length === 0) return null;
  const width = Math.min(size, pnls.length);
  let current = pnls.slice(0, width).reduce((sum, value) => sum + value, 0);
  let worst = current;
  for (let index = width; index < pnls.length; index += 1) {
    current += pnls[index]! - pnls[index - width]!;
    worst = Math.min(worst, current);
  }
  return round(worst);
}

function scenarioMetrics(
  strategy: LabStrategyState,
  roundTrips: ClosedRoundTrip[],
  definition: ScenarioDefinition,
): StressScenarioMetrics {
  const pnls = roundTrips.map((item) => stressedPnl(item, definition));
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = losses.reduce((sum, value) => sum + Math.abs(value), 0);
  const net = pnls.reduce((sum, value) => sum + value, 0);
  let equity = strategy.initialCashEur;
  let peak = equity;
  let maxDrawdown = 0;
  let losingStreak = 0;
  let longestLosingStreak = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (pnl < 0) {
      losingStreak += 1;
      longestLosingStreak = Math.max(longestLosingStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
  }

  return {
    id: definition.id,
    label: definition.label,
    feeMultiplier: definition.feeMultiplier,
    extraRoundTripCostPct: definition.extraRoundTripCostPct,
    trades: pnls.length,
    netPnlEur: round(net),
    grossProfitEur: round(grossProfit),
    grossLossEur: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    profitFactorNoLosses: grossLoss === 0 && grossProfit > 0,
    winRatePct: pnls.length > 0 ? round((wins.length / pnls.length) * 100, 4) : null,
    maxDrawdownEur: round(maxDrawdown),
    maxDrawdownPct: strategy.initialCashEur > 0 ? round(maxDrawdown / strategy.initialCashEur, 6) : 0,
    longestLosingStreak,
    worstFiveTradePnlEur: worstWindow(pnls, 5),
    profitable: net > 0,
  };
}

function profitFactorAtLeast(scenario: StressScenarioMetrics, minimum: number): boolean {
  if (scenario.profitFactorNoLosses) return scenario.grossProfitEur > 0;
  return (scenario.profitFactor ?? 0) >= minimum;
}

function evaluateStrategy(strategy: LabStrategyState): StrategyStressReport {
  const paired = pairRoundTrips(strategy);
  const scenarios = SCENARIOS.map((definition) => scenarioMetrics(strategy, paired.roundTrips, definition));
  const observed = scenarios.find((scenario) => scenario.id === "observed")!;
  const combined = scenarios.find((scenario) => scenario.id === "combined")!;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (paired.roundTrips.length < MINIMUM_ROUND_TRIPS) {
    blockers.push(`Solo hay ${paired.roundTrips.length} ciclos compra-venta; se exigen al menos ${MINIMUM_ROUND_TRIPS}.`);
  }
  if (observed.netPnlEur <= 0) blockers.push("El resultado observado no es positivo.");
  if (combined.netPnlEur <= 0) blockers.push("El escenario combinado de costes vuelve negativa la estrategia.");
  if (!profitFactorAtLeast(combined, 1)) blockers.push("El profit factor bajo estrés combinado es inferior a 1,00.");
  if (combined.maxDrawdownPct > 0.05) blockers.push("El drawdown bajo estrés combinado supera el 5 % del capital virtual.");
  if (combined.longestLosingStreak >= 6) blockers.push("El escenario combinado contiene una racha de al menos seis pérdidas consecutivas.");
  if (paired.unmatchedBuys > 0 || paired.unmatchedSells > 0) {
    warnings.push(`Historial parcial: ${paired.unmatchedBuys} compra(s) y ${paired.unmatchedSells} venta(s) sin pareja retenida.`);
  }
  if (paired.roundTrips.length >= MINIMUM_ROUND_TRIPS && paired.roundTrips.length < 60) {
    warnings.push("La muestra supera el mínimo inicial, pero aún es limitada para declarar resiliencia.");
  }

  let verdict: StressVerdict;
  if (paired.roundTrips.length < MINIMUM_ROUND_TRIPS) verdict = "insufficient";
  else if (blockers.length > 0) verdict = "fragile";
  else if (paired.roundTrips.length < 60 || !profitFactorAtLeast(combined, 1.1)) verdict = "developing";
  else verdict = "resilient_candidate";

  const interpretation = verdict === "resilient_candidate"
    ? "La estrategia conserva beneficio y control de drawdown bajo el escenario combinado. Sigue siendo evidencia PAPER."
    : verdict === "developing"
      ? "Los escenarios de estrés no destruyen el resultado, pero la muestra o el margen de seguridad aún son limitados."
      : verdict === "fragile"
        ? "La estrategia depende demasiado de costes favorables o de una secuencia benigna de operaciones."
        : "Todavía no hay suficientes ciclos compra-venta para una prueba de estrés fiable.";

  return {
    schemaVersion: "paper-cost-sequence-stress-entry-v1",
    strategyId: strategy.id,
    symbol: strategy.symbol,
    lane: strategy.lane,
    closedRoundTrips: paired.roundTrips.length,
    unmatchedBuys: paired.unmatchedBuys,
    unmatchedSells: paired.unmatchedSells,
    scenarios,
    observedScenario: observed,
    combinedScenario: combined,
    verdict,
    blockers,
    warnings,
    interpretation,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

export function buildCostSequenceStressReport(strategies: LabStrategyState[]): CostSequenceStressReport {
  const entries = strategies.map(evaluateStrategy);
  const rank = (verdict: StressVerdict): number => {
    if (verdict === "resilient_candidate") return 4;
    if (verdict === "developing") return 3;
    if (verdict === "fragile") return 2;
    return 1;
  };
  const leaderboard = [...entries].sort((left, right) =>
    rank(right.verdict) - rank(left.verdict)
    || right.combinedScenario.netPnlEur - left.combinedScenario.netPnlEur
    || left.strategyId.localeCompare(right.strategyId),
  );

  return {
    schemaVersion: "paper-cost-sequence-stress-report-v1",
    methodology: "Recalcula cada ciclo compra-venta con comisiones superiores, relleno adverso de 0,10 % por ida y vuelta y un escenario combinado. También mide drawdown, rachas de pérdidas y la peor ventana de cinco operaciones.",
    strategyCount: entries.length,
    sufficientlySampledStrategies: entries.filter((entry) => entry.closedRoundTrips >= MINIMUM_ROUND_TRIPS).length,
    resilientCandidates: entries.filter((entry) => entry.verdict === "resilient_candidate").length,
    developingStrategies: entries.filter((entry) => entry.verdict === "developing").length,
    fragileStrategies: entries.filter((entry) => entry.verdict === "fragile").length,
    insufficientStrategies: entries.filter((entry) => entry.verdict === "insufficient").length,
    entries,
    leaderboard,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
