import type { LabStrategyState } from "./research-lab";

export interface PaperOpportunityAuditLedgerState {
  schemaVersion: "paper-opportunity-audit-ledger-v1";
  initializedAt: number;
  updatedAt: number;
  cyclesObserved: number;
  signalsAnalyzed: number;
  signalsValid: number;
  operationsOpened: number;
  rejectedBySpread: number;
  rejectedByRisk: number;
  rejectedByLiquidity: number;
  rejectedByNews: number;
  rejectedByCommittee: number;
  rejectedByExposure: number;
  rejectedByMarketMinimum: number;
  rejectedByExecution: number;
  rejectedByTechnicalConfirmation: number;
  rejectedWithoutBaseSignal: number;
  rejectedOther: number;
  seenBuyTradeIds: string[];
  liveTrading: false;
}

export interface PaperOpportunityAuditLedgerReport extends Omit<PaperOpportunityAuditLedgerState, "seenBuyTradeIds"> {
  uniqueBuyIdsRetained: number;
  historical: true;
  source: "persisted-cycle-ledger";
  changesTradingDecision: false;
}

export function emptyPaperOpportunityAuditLedger(now = Date.now()): PaperOpportunityAuditLedgerState {
  return {
    schemaVersion: "paper-opportunity-audit-ledger-v1",
    initializedAt: now,
    updatedAt: now,
    cyclesObserved: 0,
    signalsAnalyzed: 0,
    signalsValid: 0,
    operationsOpened: 0,
    rejectedBySpread: 0,
    rejectedByRisk: 0,
    rejectedByLiquidity: 0,
    rejectedByNews: 0,
    rejectedByCommittee: 0,
    rejectedByExposure: 0,
    rejectedByMarketMinimum: 0,
    rejectedByExecution: 0,
    rejectedByTechnicalConfirmation: 0,
    rejectedWithoutBaseSignal: 0,
    rejectedOther: 0,
    seenBuyTradeIds: [],
    liveTrading: false,
  };
}

export function sanitizePaperOpportunityAuditLedger(value: unknown, now = Date.now()): PaperOpportunityAuditLedgerState {
  if (!value || typeof value !== "object") return emptyPaperOpportunityAuditLedger(now);
  const raw = value as Partial<PaperOpportunityAuditLedgerState>;
  const initial = emptyPaperOpportunityAuditLedger(now);
  const number = (key: keyof PaperOpportunityAuditLedgerState): number => {
    const candidate = raw[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
  };
  return {
    ...initial,
    initializedAt: typeof raw.initializedAt === "number" ? raw.initializedAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    cyclesObserved: number("cyclesObserved"),
    signalsAnalyzed: number("signalsAnalyzed"),
    signalsValid: number("signalsValid"),
    operationsOpened: number("operationsOpened"),
    rejectedBySpread: number("rejectedBySpread"),
    rejectedByRisk: number("rejectedByRisk"),
    rejectedByLiquidity: number("rejectedByLiquidity"),
    rejectedByNews: number("rejectedByNews"),
    rejectedByCommittee: number("rejectedByCommittee"),
    rejectedByExposure: number("rejectedByExposure"),
    rejectedByMarketMinimum: number("rejectedByMarketMinimum"),
    rejectedByExecution: number("rejectedByExecution"),
    rejectedByTechnicalConfirmation: number("rejectedByTechnicalConfirmation"),
    rejectedWithoutBaseSignal: number("rejectedWithoutBaseSignal"),
    rejectedOther: number("rejectedOther"),
    seenBuyTradeIds: Array.isArray(raw.seenBuyTradeIds)
      ? raw.seenBuyTradeIds.filter((id): id is string => typeof id === "string").slice(-2_000)
      : [],
    liveTrading: false,
  };
}

function classify(decision: string): keyof Pick<
  PaperOpportunityAuditLedgerState,
  | "rejectedBySpread"
  | "rejectedByRisk"
  | "rejectedByLiquidity"
  | "rejectedByNews"
  | "rejectedByCommittee"
  | "rejectedByExposure"
  | "rejectedByMarketMinimum"
  | "rejectedByExecution"
  | "rejectedByTechnicalConfirmation"
  | "rejectedWithoutBaseSignal"
  | "rejectedOther"
> {
  const value = decision.toLowerCase();
  if (value.includes("spread")) return "rejectedBySpread";
  if (value.includes("liquidez") || value.includes("profundidad")) return "rejectedByLiquidity";
  if (value.includes("noticias") || value.includes("informativo")) return "rejectedByNews";
  if (value.includes("comité")) return "rejectedByCommittee";
  if (value.includes("tesorería") || value.includes("exposición") || value.includes("capital asignable")) return "rejectedByExposure";
  if (value.includes("drawdown") || value.includes("riesgo")) return "rejectedByRisk";
  if (value.includes("mínimo")) return "rejectedByMarketMinimum";
  if (value.includes("ejecución") || value.includes("costes")) return "rejectedByExecution";
  if (value.includes("confianza") || value.includes("ruptura") || value.includes("multitemporal") || value.includes("gráfica") || value.includes("cooldown") || value.includes("vela cerrada")) return "rejectedByTechnicalConfirmation";
  if (value.includes("sin señal")) return "rejectedWithoutBaseSignal";
  return "rejectedOther";
}

export function advancePaperOpportunityAuditLedger(
  current: PaperOpportunityAuditLedgerState,
  strategies: LabStrategyState[],
  cycleTimestamp: number | null,
  now = Date.now(),
): PaperOpportunityAuditLedgerState {
  const next = sanitizePaperOpportunityAuditLedger(current, now);
  const seen = new Set(next.seenBuyTradeIds);
  const processed = cycleTimestamp === null
    ? []
    : strategies.filter((strategy) => strategy.lastAttemptAt === cycleTimestamp);
  let newBuys = 0;
  for (const strategy of processed) {
    const unseenBuyIds = strategy.trades
      .filter((trade) => trade.side === "buy" && !seen.has(trade.id))
      .map((trade) => trade.id);
    if (unseenBuyIds.length > 0) {
      unseenBuyIds.forEach((id) => seen.add(id));
      newBuys += unseenBuyIds.length;
      continue;
    }
    const category = classify(strategy.lastDecision);
    next[category] += 1;
  }
  next.updatedAt = now;
  next.cyclesObserved += cycleTimestamp === null ? 0 : 1;
  next.signalsAnalyzed += processed.length;
  next.signalsValid += newBuys;
  next.operationsOpened += newBuys;
  next.seenBuyTradeIds = [...seen].slice(-2_000);
  next.liveTrading = false;
  return next;
}

export function buildPaperOpportunityAuditLedgerReport(
  state: PaperOpportunityAuditLedgerState,
): PaperOpportunityAuditLedgerReport {
  const { seenBuyTradeIds, ...publicState } = state;
  return {
    ...publicState,
    uniqueBuyIdsRetained: seenBuyTradeIds.length,
    historical: true,
    source: "persisted-cycle-ledger",
    changesTradingDecision: false,
    liveTrading: false,
  };
}
