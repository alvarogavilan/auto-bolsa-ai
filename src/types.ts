// Nombre fijo del único BotState desplegado. Es también la autoridad única del
// nonce de Kraken: cualquier código que firme llamadas privadas (incluido el
// ejecutor LIVE) debe pedir el nonce a esta instancia, nunca mantener su propio
// contador. Ver `nextKrakenNonce` en bot-state.ts.
export const BOT_STATE_SINGLETON_NAME = "auto-bolsa-ai-singleton";

export interface Env {
  BOT_STATE: DurableObjectNamespace;
  RESEARCH_LAB: DurableObjectNamespace;
  // No hay LIVE_EXECUTOR: LiveExecutorState no está enlazado en wrangler.jsonc
  // ni desplegado en Cloudflare. Ver docs/live-executor.md.
  TRADING_MODE: string;
  PAIR: string;
  INITIAL_CASH_EUR: string;
  ADMIN_TOKEN?: string;
  KRAKEN_API_KEY?: string;
  KRAKEN_API_SECRET?: string;
  // Interruptor estructural del ejecutor LIVE. Debe permanecer ausente o "false":
  // ninguna ruta del Worker lo lee para servir tráfico real. Ver docs/live-executor.md.
  LIVE_TRADING_ENABLED?: string;
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

export interface PaperPerformance {
  buyTrades: number;
  sellTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  grossProfitEur: number;
  grossLossEur: number;
  netPnlEur: number;
  totalFeesEur: number;
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
  paperStartedAt: number;
  evidenceStartedAt: number;
  evidenceMethod: "closed-15m-candles-v1";
  ticksObserved: number;
  uniqueClosedCandlesObserved: number;
  duplicateCandleSkips: number;
  errorsObserved: number;
  consecutiveErrors: number;
  lastError: string | null;
  maxObservedDrawdownPct: number;
  lastClosedCandleTime: number | null;
  lastPrice: number | null;
  lastTickAt: number | null;
  lastSuccessfulTickAt: number | null;
  lastTradeAt: number | null;
  lastDecision: string;
  config: BotConfig;
  performance: PaperPerformance;
  trades: PaperTrade[];
}
