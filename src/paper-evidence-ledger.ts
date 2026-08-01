import type { LabStrategyState, LabTrade } from "./research-lab";

export interface PaperEvidenceStrategyLedger {
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  trades: LabTrade[];
}

export interface PaperEvidenceLedgerState {
  schemaVersion: "paper-evidence-ledger-state-v1";
  initializedAt: number;
  updatedAt: number;
  seenTradeIds: string[];
  strategies: Record<string, PaperEvidenceStrategyLedger>;
  changesTradingDecision: false;
  liveTrading: false;
}

export interface PaperEvidenceStrategySummary {
  strategyId: string;
  symbol: string;
  lane: LabStrategyState["lane"];
  movements: number;
  buys: number;
  sells: number;
  closedTrades: number;
  earliestTradeAt: number | null;
  latestTradeAt: number | null;
}

export interface PaperEvidenceLedgerReport {
  schemaVersion: "paper-evidence-ledger-report-v1";
  generatedAt: number;
  strategyCount: number;
  totalMovements: number;
  buys: number;
  sells: number;
  closedTrades: number;
  earliestTradeAt: number | null;
  latestTradeAt: number | null;
  maxMovementsPerStrategy: 1000;
  strategies: PaperEvidenceStrategySummary[];
  changesTradingDecision: false;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export const MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY = 1_000;
const MAX_SEEN_TRADE_IDS = 20_000;

function validLane(value: unknown): value is LabStrategyState["lane"] {
  return value === "fast" || value === "intraday" || value === "swing";
}

function validTrade(value: unknown): value is LabTrade {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const trade = value as Partial<LabTrade>;
  return typeof trade.id === "string"
    && (trade.side === "buy" || trade.side === "sell")
    && typeof trade.timestamp === "number"
    && Number.isFinite(trade.timestamp)
    && typeof trade.price === "number"
    && Number.isFinite(trade.price)
    && typeof trade.quantity === "number"
    && Number.isFinite(trade.quantity)
    && typeof trade.grossEur === "number"
    && Number.isFinite(trade.grossEur)
    && typeof trade.feeEur === "number"
    && Number.isFinite(trade.feeEur)
    && typeof trade.reason === "string"
    && (trade.pnlEur === undefined || (typeof trade.pnlEur === "number" && Number.isFinite(trade.pnlEur)));
}

function chronological(trades: LabTrade[]): LabTrade[] {
  return [...trades].sort((left, right) =>
    left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
}

export function emptyPaperEvidenceLedgerState(now = Date.now()): PaperEvidenceLedgerState {
  return {
    schemaVersion: "paper-evidence-ledger-state-v1",
    initializedAt: now,
    updatedAt: now,
    seenTradeIds: [],
    strategies: {},
    changesTradingDecision: false,
    liveTrading: false,
  };
}

export function sanitizePaperEvidenceLedgerState(
  value: unknown,
  now = Date.now(),
): PaperEvidenceLedgerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyPaperEvidenceLedgerState(now);
  }
  const candidate = value as Partial<PaperEvidenceLedgerState>;
  if (candidate.schemaVersion !== "paper-evidence-ledger-state-v1") {
    return emptyPaperEvidenceLedgerState(now);
  }

  const strategies: Record<string, PaperEvidenceStrategyLedger> = {};
  if (candidate.strategies && typeof candidate.strategies === "object" && !Array.isArray(candidate.strategies)) {
    for (const [strategyId, raw] of Object.entries(candidate.strategies)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Partial<PaperEvidenceStrategyLedger>;
      if (
        item.strategyId !== strategyId
        || typeof item.symbol !== "string"
        || !validLane(item.lane)
        || !Array.isArray(item.trades)
      ) continue;
      strategies[strategyId] = {
        strategyId,
        symbol: item.symbol,
        lane: item.lane,
        trades: chronological(item.trades.filter(validTrade)).slice(-MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY),
      };
    }
  }

  const derivedIds = Object.values(strategies).flatMap((item) => item.trades.map((trade) => trade.id));
  const storedIds = Array.isArray(candidate.seenTradeIds)
    ? candidate.seenTradeIds.filter((item): item is string => typeof item === "string")
    : [];

  return {
    schemaVersion: "paper-evidence-ledger-state-v1",
    initializedAt: typeof candidate.initializedAt === "number" && Number.isFinite(candidate.initializedAt)
      ? candidate.initializedAt
      : now,
    updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : now,
    seenTradeIds: [...new Set([...storedIds, ...derivedIds])].slice(-MAX_SEEN_TRADE_IDS),
    strategies,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

export function applyPaperEvidenceSnapshot(
  current: PaperEvidenceLedgerState,
  strategies: LabStrategyState[],
  now = Date.now(),
): PaperEvidenceLedgerState {
  const state = sanitizePaperEvidenceLedgerState(current, now);
  const seen = new Set(state.seenTradeIds);
  const ledgers: Record<string, PaperEvidenceStrategyLedger> = Object.fromEntries(
    Object.entries(state.strategies).map(([strategyId, ledger]) => [
      strategyId,
      { ...ledger, trades: [...ledger.trades] },
    ]),
  );

  for (const strategy of strategies) {
    const existing = ledgers[strategy.id] ?? {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      lane: strategy.lane,
      trades: [],
    };
    existing.symbol = strategy.symbol;
    existing.lane = strategy.lane;

    for (const trade of chronological(strategy.trades.filter(validTrade))) {
      if (seen.has(trade.id)) continue;
      seen.add(trade.id);
      existing.trades.push({ ...trade });
    }
    existing.trades = chronological(existing.trades).slice(-MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY);
    ledgers[strategy.id] = existing;
  }

  const retainedIds = Object.values(ledgers).flatMap((item) => item.trades.map((trade) => trade.id));
  const orderedSeen = [...seen].filter((id) => !retainedIds.includes(id));
  const seenTradeIds = [...orderedSeen, ...retainedIds].slice(-MAX_SEEN_TRADE_IDS);

  return {
    schemaVersion: "paper-evidence-ledger-state-v1",
    initializedAt: state.initializedAt,
    updatedAt: now,
    seenTradeIds,
    strategies: ledgers,
    changesTradingDecision: false,
    liveTrading: false,
  };
}

export function hydrateStrategiesWithEvidence(
  strategies: LabStrategyState[],
  ledger: PaperEvidenceLedgerState,
): LabStrategyState[] {
  const safe = sanitizePaperEvidenceLedgerState(ledger);
  return strategies.map((strategy) => {
    const evidence = safe.strategies[strategy.id];
    if (!evidence || evidence.trades.length === 0) {
      return { ...strategy, trades: [...strategy.trades] };
    }
    return {
      ...strategy,
      trades: chronological(evidence.trades).reverse(),
    };
  });
}

function summary(item: PaperEvidenceStrategyLedger): PaperEvidenceStrategySummary {
  const trades = chronological(item.trades);
  const buys = trades.filter((trade) => trade.side === "buy").length;
  const sells = trades.filter((trade) => trade.side === "sell").length;
  const closedTrades = trades.filter((trade) =>
    trade.side === "sell" && typeof trade.pnlEur === "number" && Number.isFinite(trade.pnlEur),
  ).length;
  return {
    strategyId: item.strategyId,
    symbol: item.symbol,
    lane: item.lane,
    movements: trades.length,
    buys,
    sells,
    closedTrades,
    earliestTradeAt: trades[0]?.timestamp ?? null,
    latestTradeAt: trades.at(-1)?.timestamp ?? null,
  };
}

export function buildPaperEvidenceLedgerReport(
  value: PaperEvidenceLedgerState,
  now = Date.now(),
): PaperEvidenceLedgerReport {
  const state = sanitizePaperEvidenceLedgerState(value, now);
  const strategies = Object.values(state.strategies)
    .map(summary)
    .sort((left, right) =>
      right.closedTrades - left.closedTrades
      || right.movements - left.movements
      || left.strategyId.localeCompare(right.strategyId),
    );
  const times = strategies.flatMap((item) =>
    [item.earliestTradeAt, item.latestTradeAt].filter((time): time is number => typeof time === "number"),
  );

  return {
    schemaVersion: "paper-evidence-ledger-report-v1",
    generatedAt: now,
    strategyCount: strategies.length,
    totalMovements: strategies.reduce((sum, item) => sum + item.movements, 0),
    buys: strategies.reduce((sum, item) => sum + item.buys, 0),
    sells: strategies.reduce((sum, item) => sum + item.sells, 0),
    closedTrades: strategies.reduce((sum, item) => sum + item.closedTrades, 0),
    earliestTradeAt: times.length > 0 ? Math.min(...times) : null,
    latestTradeAt: times.length > 0 ? Math.max(...times) : null,
    maxMovementsPerStrategy: MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY,
    strategies,
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
