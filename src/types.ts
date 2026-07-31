export interface Env {
  BOT_STATE: DurableObjectNamespace;
  TRADING_MODE: string;
  PAIR: string;
  INITIAL_CASH_EUR: string;
  ADMIN_TOKEN?: string;
  KRAKEN_API_KEY?: string;
  KRAKEN_API_SECRET?: string;
}

export type Side = "buy" | "sell";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  fastEma: number;
  slowEma: number;
  previousFastEma: number;
  previousSlowEma: number;
  rsi: number;
  price: number;
}

export interface Position {
  asset: "BTC";
  quantity: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  costEur: number;
}

export interface PaperTrade {
  id: string;
  side: Side;
  price: number;
  quantity: number;
  grossEur: number;
  feeEur: number;
  timestamp: number;
  reason: string;
  pnlEur?: number;
}

export interface BotConfig {
  pair: string;
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  maxExposurePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  cooldownMinutes: number;
  feePct: number;
  slippagePct: number;
}

export interface BotSnapshot {
  version: string;
  mode: "paper";
  paused: boolean;
  initialCashEur: number;
  cashEur: number;
  position: Position | null;
  equityEur: number;
  peakEquityEur: number;
  dayStartEquityEur: number;
  dayKey: string;
  lastPrice: number | null;
  lastTickAt: number | null;
  lastTradeAt: number | null;
  lastDecision: string;
  config: BotConfig;
  trades: PaperTrade[];
}
