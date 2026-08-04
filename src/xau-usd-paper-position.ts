import type { XauPaperInstruction, XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export const XAU_PAPER_POSITION_KEY = "xau-usd:paper-position-book:v1";
const TRAILING_ACTIVATION_R = 1;
const TRAILING_DISTANCE_R = 0.75;
const LOCKED_PROFIT_R = 0.25;
const MAX_CLOSED_POSITIONS = 100;
const ROUND_TRIP_COST_PCT = 0.005;
const MIN_MEANINGFUL_NET_PROFIT_EUR = 0.5;

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
  unrealizedPnlEur: number;
}

export interface XauClosedPaperPosition extends XauPaperPosition {
  closedAt: number;
  exitPrice: number;
  realizedPnlEur: number;
  grossPnlEur: number;
  closeReason: "stop";
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
  liveTrading: false;
  realOrderSubmission: false;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function createXauPaperPositionBook(): XauPaperPositionBook {
  return {
    schemaVersion: "xau-usd-paper-position-book-v1",
    market: "XAU/USD",
    open: null,
    closed: [],
    metrics: { opened: 0, closed: 0, winners: 0, losers: 0, realizedPnlEur: 0, unrealizedPnlEur: 0, protectedPnlEur: 0 },
    liveTrading: false,
    realOrderSubmission: false,
  };
}

export function parseXauPaperPositionBook(raw: string | null): XauPaperPositionBook {
  if (!raw) return createXauPaperPositionBook();
  try {
    const value = JSON.parse(raw) as XauPaperPositionBook;
    return value.schemaVersion === "xau-usd-paper-position-book-v1" && value.market === "XAU/USD"
      ? value
      : createXauPaperPositionBook();
  } catch {
    return createXauPaperPositionBook();
  }
}

function markPrice(position: XauPaperPosition, input: XauPaperRuntimeInput): number {
  return position.side === "buy" ? input.quote.bid : input.quote.ask;
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

function openPosition(instruction: XauPaperInstruction): XauPaperPosition | null {
  if (!instruction.allowed || instruction.action === "hold" || instruction.referencePrice === null || instruction.stopPrice === null || instruction.initialTargetPrice === null) return null;
  const quantityOz = instruction.budgetEur / instruction.referencePrice;
  const estimatedRoundTripCostEur = rounded(instruction.budgetEur * ROUND_TRIP_COST_PCT);
  return {
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
    unrealizedPnlEur: -estimatedRoundTripCostEur,
  };
}

function manageOpenPosition(position: XauPaperPosition, input: XauPaperRuntimeInput): XauClosedPaperPosition | null {
  const price = markPrice(position, input);
  position.lastMarkPrice = price;
  position.lastMarkedAt = input.quote.observedAt;
  position.highWaterPrice = Math.max(position.highWaterPrice, price);
  position.lowWaterPrice = Math.min(position.lowWaterPrice, price);
  const risk = Math.abs(position.entryPrice - position.initialStopPrice);
  const favourableMove = position.side === "buy" ? price - position.entryPrice : position.entryPrice - price;
  const currentNetPnl = netPnlAt(position, price);

  if (
    risk > 0
    && favourableMove >= risk * TRAILING_ACTIVATION_R
    && currentNetPnl >= position.minimumMeaningfulNetProfitEur
  ) {
    position.trailingActive = true;
    const meaningfulProfitPrice = priceForNetProfit(position, position.minimumMeaningfulNetProfitEur);
    if (position.side === "buy") {
      const locked = position.entryPrice + risk * LOCKED_PROFIT_R;
      const trailing = position.highWaterPrice - risk * TRAILING_DISTANCE_R;
      position.stopPrice = Math.max(position.stopPrice, locked, trailing, meaningfulProfitPrice);
      position.targetPrice = Math.max(position.targetPrice, position.highWaterPrice + risk);
    } else {
      const locked = position.entryPrice - risk * LOCKED_PROFIT_R;
      const trailing = position.lowWaterPrice + risk * TRAILING_DISTANCE_R;
      position.stopPrice = Math.min(position.stopPrice, locked, trailing, meaningfulProfitPrice);
      position.targetPrice = Math.min(position.targetPrice, position.lowWaterPrice - risk);
    }
  }

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
    unrealizedPnlEur: 0,
  };
}

export function applyXauPaperPositionCycle(
  current: XauPaperPositionBook,
  instruction: XauPaperInstruction,
  input: XauPaperRuntimeInput,
): XauPaperPositionBook {
  const book: XauPaperPositionBook = JSON.parse(JSON.stringify(current)) as XauPaperPositionBook;
  if (book.open) {
    const closed = manageOpenPosition(book.open, input);
    if (closed) {
      book.closed = [closed, ...book.closed].slice(0, MAX_CLOSED_POSITIONS);
      book.open = null;
      book.metrics.closed += 1;
      book.metrics.winners += closed.realizedPnlEur >= MIN_MEANINGFUL_NET_PROFIT_EUR ? 1 : 0;
      book.metrics.losers += closed.realizedPnlEur < MIN_MEANINGFUL_NET_PROFIT_EUR ? 1 : 0;
      book.metrics.realizedPnlEur = rounded(book.metrics.realizedPnlEur + closed.realizedPnlEur);
    }
  }

  if (!book.open) {
    const opened = openPosition(instruction);
    if (opened) {
      book.open = opened;
      book.metrics.opened += 1;
    }
  }

  book.metrics.unrealizedPnlEur = book.open?.unrealizedPnlEur ?? 0;
  book.metrics.protectedPnlEur = book.open?.protectedPnlEur ?? 0;
  return book;
}
