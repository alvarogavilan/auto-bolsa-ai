import type { XauPaperInstruction, XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export const XAU_PAPER_POSITION_KEY = "xau-usd:paper-position-book:v1";
const TRAILING_ACTIVATION_R = 1;
const TRAILING_DISTANCE_R = 0.75;
const LOCKED_PROFIT_R = 0.25;
const MAX_CLOSED_POSITIONS = 100;
const MAX_EQUITY_POINTS = 1_000;
const ROUND_TRIP_COST_PCT = 0.005;
const MIN_MEANINGFUL_NET_PROFIT_EUR = 0.5;
const PAPER_TREASURY_EUR = 100;

export interface XauPaperPosition {
  id: string;
  side: "buy" | "sell";
  openedAt: number;
  entryPrice: number;
  quantityOz: number;
  budgetEur: number;
  estimatedRoundTripCostEur: number;
  minimumMeaningfulNetProfitEur: number;
  initialStopPrice: number;
  stopPrice: number;
  targetPrice: number;
  highWaterPrice: number;
  lowWaterPrice: number;
  lastMarkPrice: number;
  lastMarkedAt: number;
  trailingActive: boolean;
  protectedPnlEur: number;
  grossUnrealizedPnlEur: number;
  unrealizedPnlEur: number;
  netBreakEvenPrice: number;
}

export interface XauClosedPaperPosition extends XauPaperPosition {
  closedAt: number;
  exitPrice: number;
  realizedPnlEur: number;
  grossPnlEur: number;
  closeReason: "stop";
}

export interface XauPaperEquityPoint {
  observedAt: number;
  cashEur: number;
  committedCapitalEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  equityEur: number;
  event: "migration" | "open" | "mark" | "close";
  positionId: string | null;
}

export interface XauPaperTreasury {
  schemaVersion: "xau-paper-treasury-v1";
  initialCapitalEur: number;
  cashEur: number;
  committedCapitalEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  equityEur: number;
  availableCapitalEur: number;
  equityCurve: XauPaperEquityPoint[];
  migratedExistingPosition: boolean;
}

export interface XauPaperPositionBook {
  schemaVersion: "xau-usd-paper-position-book-v1";
  market: "XAU/USD";
  open: XauPaperPosition | null;
  closed: XauClosedPaperPosition[];
  metrics: {
    opened: number;
    closed: number;
    winners: number;
    losers: number;
    realizedPnlEur: number;
    unrealizedPnlEur: number;
    protectedPnlEur: number;
  };
  treasury: XauPaperTreasury;
  liveTrading: false;
  realOrderSubmission: false;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyTreasury(): XauPaperTreasury {
  return {
    schemaVersion: "xau-paper-treasury-v1",
    initialCapitalEur: PAPER_TREASURY_EUR,
    cashEur: PAPER_TREASURY_EUR,
    committedCapitalEur: 0,
    realizedPnlEur: 0,
    unrealizedPnlEur: 0,
    equityEur: PAPER_TREASURY_EUR,
    availableCapitalEur: PAPER_TREASURY_EUR,
    equityCurve: [],
    migratedExistingPosition: false,
  };
}

export function createXauPaperPositionBook(): XauPaperPositionBook {
  return {
    schemaVersion: "xau-usd-paper-position-book-v1",
    market: "XAU/USD",
    open: null,
    closed: [],
    metrics: { opened: 0, closed: 0, winners: 0, losers: 0, realizedPnlEur: 0, unrealizedPnlEur: 0, protectedPnlEur: 0 },
    treasury: emptyTreasury(),
    liveTrading: false,
    realOrderSubmission: false,
  };
}

function sanitizeEquityCurve(points: XauPaperEquityPoint[]): XauPaperEquityPoint[] {
  const seen = new Set<string>();
  return [...points]
    .filter((point) => {
      const key = [
        point.observedAt,
        point.cashEur,
        point.committedCapitalEur,
        point.realizedPnlEur,
        point.unrealizedPnlEur,
        point.equityEur,
        point.event,
        point.positionId ?? "",
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.observedAt - right.observedAt)
    .slice(-MAX_EQUITY_POINTS);
}

function refreshTreasurySummary(book: XauPaperPositionBook): void {
  const prior = book.treasury ?? emptyTreasury();
  const committed = book.open?.budgetEur ?? 0;
  const realized = book.metrics.realizedPnlEur;
  const unrealized = book.open?.unrealizedPnlEur ?? 0;
  const cash = rounded(PAPER_TREASURY_EUR + realized - committed);
  book.treasury = {
    schemaVersion: "xau-paper-treasury-v1",
    initialCapitalEur: PAPER_TREASURY_EUR,
    cashEur: cash,
    committedCapitalEur: committed,
    realizedPnlEur: realized,
    unrealizedPnlEur: unrealized,
    equityEur: rounded(PAPER_TREASURY_EUR + realized + unrealized),
    availableCapitalEur: Math.max(0, cash),
    equityCurve: sanitizeEquityCurve(prior.equityCurve ?? []),
    migratedExistingPosition: prior.migratedExistingPosition,
  };
}

function reconcileTreasury(book: XauPaperPositionBook, observedAt: number, event: XauPaperEquityPoint["event"]): void {
  refreshTreasurySummary(book);
  const prior = book.treasury;
  const point: XauPaperEquityPoint = {
    observedAt,
    cashEur: prior.cashEur,
    committedCapitalEur: prior.committedCapitalEur,
    realizedPnlEur: prior.realizedPnlEur,
    unrealizedPnlEur: prior.unrealizedPnlEur,
    equityEur: prior.equityEur,
    event,
    positionId: book.open?.id ?? null,
  };
  book.treasury.equityCurve = sanitizeEquityCurve([...prior.equityCurve, point]);
}

function grossPnlAt(position: XauPaperPosition, price: number): number {
  const direction = position.side === "buy" ? 1 : -1;
  return rounded((price - position.entryPrice) * position.quantityOz * direction);
}

function netPnlAt(position: XauPaperPosition, price: number): number {
  return rounded(grossPnlAt(position, price) - position.estimatedRoundTripCostEur);
}

function priceForNetProfit(position: XauPaperPosition, netProfitEur: number): number {
  const grossNeeded = netProfitEur + position.estimatedRoundTripCostEur;
  const move = grossNeeded / position.quantityOz;
  return position.side === "buy" ? position.entryPrice + move : position.entryPrice - move;
}

function normalizeOpenPosition(position: XauPaperPosition): XauPaperPosition {
  const netBreakEvenPrice = Number.isFinite(position.netBreakEvenPrice)
    ? position.netBreakEvenPrice
    : priceForNetProfit(position, 0);
  const grossUnrealizedPnlEur = Number.isFinite(position.grossUnrealizedPnlEur)
    ? position.grossUnrealizedPnlEur
    : grossPnlAt(position, position.lastMarkPrice);
  const protectedPnlEur = Math.max(0, netPnlAt(position, position.stopPrice));
  const netProtectionIsReal = protectedPnlEur > 0;
  return {
    ...position,
    netBreakEvenPrice: rounded(netBreakEvenPrice),
    grossUnrealizedPnlEur: rounded(grossUnrealizedPnlEur),
    protectedPnlEur: rounded(protectedPnlEur),
    trailingActive: Boolean(position.trailingActive && netProtectionIsReal),
  };
}

export function parseXauPaperPositionBook(raw: string | null): XauPaperPositionBook {
  if (!raw) return createXauPaperPositionBook();
  try {
    const value = JSON.parse(raw) as XauPaperPositionBook;
    if (value.schemaVersion !== "xau-usd-paper-position-book-v1" || value.market !== "XAU/USD") return createXauPaperPositionBook();
    const legacy = !value.treasury;
    const book = { ...value, treasury: value.treasury ?? emptyTreasury() };
    if (book.open) book.open = normalizeOpenPosition(book.open);
    if (legacy && book.open) {
      book.treasury.migratedExistingPosition = true;
      reconcileTreasury(book, book.open.lastMarkedAt, "migration");
    } else {
      refreshTreasurySummary(book);
    }
    return book;
  } catch {
    return createXauPaperPositionBook();
  }
}

function markPrice(position: XauPaperPosition, input: XauPaperRuntimeInput): number {
  return position.side === "buy" ? input.quote.bid : input.quote.ask;
}

function openPosition(instruction: XauPaperInstruction, availableCapitalEur: number): XauPaperPosition | null {
  if (!instruction.allowed || instruction.action === "hold" || instruction.referencePrice === null || instruction.stopPrice === null || instruction.initialTargetPrice === null) return null;
  if (instruction.budgetEur <= 0 || instruction.budgetEur > availableCapitalEur) return null;
  const quantityOz = instruction.budgetEur / instruction.referencePrice;
  const estimatedRoundTripCostEur = rounded(instruction.budgetEur * ROUND_TRIP_COST_PCT);
  const base: XauPaperPosition = {
    id: `xau-${instruction.createdAt}-${instruction.action}`,
    side: instruction.action,
    openedAt: instruction.createdAt,
    entryPrice: instruction.referencePrice,
    quantityOz: rounded(quantityOz),
    budgetEur: instruction.budgetEur,
    estimatedRoundTripCostEur,
    minimumMeaningfulNetProfitEur: MIN_MEANINGFUL_NET_PROFIT_EUR,
    initialStopPrice: instruction.stopPrice,
    stopPrice: instruction.stopPrice,
    targetPrice: instruction.initialTargetPrice,
    highWaterPrice: instruction.referencePrice,
    lowWaterPrice: instruction.referencePrice,
    lastMarkPrice: instruction.referencePrice,
    lastMarkedAt: instruction.createdAt,
    trailingActive: false,
    protectedPnlEur: 0,
    grossUnrealizedPnlEur: 0,
    unrealizedPnlEur: -estimatedRoundTripCostEur,
    netBreakEvenPrice: 0,
  };
  base.netBreakEvenPrice = rounded(priceForNetProfit(base, 0));
  return base;
}

function manageOpenPosition(position: XauPaperPosition, input: XauPaperRuntimeInput): XauClosedPaperPosition | null {
  const price = markPrice(position, input);
  position.lastMarkPrice = price;
  position.lastMarkedAt = input.quote.observedAt;
  position.highWaterPrice = Math.max(position.highWaterPrice, price);
  position.lowWaterPrice = Math.min(position.lowWaterPrice, price);
  position.netBreakEvenPrice = rounded(priceForNetProfit(position, 0));
  const risk = Math.abs(position.entryPrice - position.initialStopPrice);
  const favourableMove = position.side === "buy" ? price - position.entryPrice : position.entryPrice - price;
  const currentGrossPnl = grossPnlAt(position, price);
  const currentNetPnl = netPnlAt(position, price);
  const netBreakEvenReached = currentNetPnl >= 0;

  if (!netBreakEvenReached) {
    position.trailingActive = false;
  } else if (risk > 0 && favourableMove >= risk * TRAILING_ACTIVATION_R) {
    position.trailingActive = true;
    const netBreakEvenPrice = priceForNetProfit(position, 0);
    if (position.side === "buy") {
      const locked = position.entryPrice + risk * LOCKED_PROFIT_R;
      const trailing = position.highWaterPrice - risk * TRAILING_DISTANCE_R;
      position.stopPrice = Math.max(position.stopPrice, netBreakEvenPrice, locked, trailing);
      position.targetPrice = Math.max(position.targetPrice, position.highWaterPrice + risk);
    } else {
      const locked = position.entryPrice - risk * LOCKED_PROFIT_R;
      const trailing = position.lowWaterPrice + risk * TRAILING_DISTANCE_R;
      position.stopPrice = Math.min(position.stopPrice, netBreakEvenPrice, locked, trailing);
      position.targetPrice = Math.min(position.targetPrice, position.lowWaterPrice - risk);
    }
  }

  position.grossUnrealizedPnlEur = currentGrossPnl;
  position.unrealizedPnlEur = currentNetPnl;
  position.protectedPnlEur = position.trailingActive ? Math.max(0, netPnlAt(position, position.stopPrice)) : 0;
  const stopped = position.side === "buy" ? price <= position.stopPrice : price >= position.stopPrice;
  if (!stopped) return null;

  const grossPnlEur = grossPnlAt(position, price);
  const realizedPnlEur = netPnlAt(position, price);
  return {
    ...position,
    closedAt: input.now,
    exitPrice: price,
    grossPnlEur,
    realizedPnlEur,
    closeReason: "stop",
    grossUnrealizedPnlEur: 0,
    unrealizedPnlEur: 0,
  };
}

export function applyXauPaperPositionCycle(current: XauPaperPositionBook, instruction: XauPaperInstruction, input: XauPaperRuntimeInput): XauPaperPositionBook {
  const book: XauPaperPositionBook = JSON.parse(JSON.stringify(current)) as XauPaperPositionBook;
  if (!book.treasury) book.treasury = emptyTreasury();
  if (book.open) book.open = normalizeOpenPosition(book.open);
  let event: XauPaperEquityPoint["event"] = "mark";
  if (book.open) {
    const closed = manageOpenPosition(book.open, input);
    if (closed) {
      book.closed = [closed, ...book.closed].slice(0, MAX_CLOSED_POSITIONS);
      book.open = null;
      book.metrics.closed += 1;
      book.metrics.winners += closed.realizedPnlEur >= MIN_MEANINGFUL_NET_PROFIT_EUR ? 1 : 0;
      book.metrics.losers += closed.realizedPnlEur < MIN_MEANINGFUL_NET_PROFIT_EUR ? 1 : 0;
      book.metrics.realizedPnlEur = rounded(book.metrics.realizedPnlEur + closed.realizedPnlEur);
      event = "close";
    }
  }

  if (!book.open) {
    const opened = openPosition(instruction, book.treasury.availableCapitalEur);
    if (opened) {
      book.open = opened;
      book.metrics.opened += 1;
      event = "open";
    }
  }

  book.metrics.unrealizedPnlEur = book.open?.unrealizedPnlEur ?? 0;
  book.metrics.protectedPnlEur = book.open?.protectedPnlEur ?? 0;
  reconcileTreasury(book, input.quote.observedAt, event);
  return book;
}
