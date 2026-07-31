// Puertas estructurales del ejecutor LIVE. Todas las comprobaciones son puras y
// deliberadamente redundantes: el interruptor `liveTradingEnabled` es la única que
// necesita fallar para bloquear cualquier envío, pero cada una se evalúa de forma
// independiente para que ningún cambio futuro pueda "olvidar" una sola puerta.

export interface LiveGuardrailConfig {
  liveTradingEnabled: boolean;
  maxOrderNotionalEur: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxConsecutiveTransportErrors: number;
  maxMarketDataAgeMs: number;
}

export type LiveOrderIntent = "open" | "close";

export interface LiveGuardrailContext {
  orderIntent: LiveOrderIntent;
  hasActiveOrder: boolean;
  hasOpenPosition: boolean;
  requestedNotionalEur: number;
  dayStartEquityEur: number;
  currentEquityEur: number;
  peakEquityEur: number;
  consecutiveTransportErrors: number;
  lastMarketDataAt: number | null;
  emergencyStopActive: boolean;
}

export interface LiveGuardrailResult {
  allowed: boolean;
  blockers: string[];
}

export const DEFAULT_MAX_ORDER_NOTIONAL_EUR = 5;

export function defaultLiveGuardrailConfig(
  overrides: Partial<LiveGuardrailConfig> = {},
): LiveGuardrailConfig {
  return {
    liveTradingEnabled: false,
    maxOrderNotionalEur: DEFAULT_MAX_ORDER_NOTIONAL_EUR,
    maxDailyLossPct: 0.01,
    maxDrawdownPct: 0.05,
    maxConsecutiveTransportErrors: 3,
    maxMarketDataAgeMs: 5 * 60_000,
    ...overrides,
  };
}

export function liveTradingEnabledFromEnv(value: string | undefined): boolean {
  return value === "true";
}

export function evaluateLiveGuardrails(
  config: LiveGuardrailConfig,
  context: LiveGuardrailContext,
  now = Date.now(),
): LiveGuardrailResult {
  const blockers: string[] = [];

  // Interruptor estructural: ausente o "false" bloquea siempre, sin excepción.
  if (!config.liveTradingEnabled) {
    blockers.push("LIVE_TRADING_ENABLED no está activado");
  }

  if (context.emergencyStopActive) {
    blockers.push("Parada de emergencia activa");
  }

  if (context.hasActiveOrder) {
    blockers.push("Ya existe una orden activa (límite estructural de una sola orden)");
  }

  if (context.orderIntent === "open" && context.hasOpenPosition) {
    blockers.push("Ya existe una posición abierta (límite estructural de una sola posición)");
  }

  if (context.orderIntent === "close" && !context.hasOpenPosition) {
    blockers.push("No hay posición abierta que cerrar");
  }

  if (context.requestedNotionalEur > config.maxOrderNotionalEur) {
    blockers.push(
      `Tamaño solicitado ${context.requestedNotionalEur} EUR supera el máximo configurado ${config.maxOrderNotionalEur} EUR`,
    );
  }

  if (context.requestedNotionalEur <= 0) {
    blockers.push("El tamaño solicitado debe ser positivo");
  }

  if (context.dayStartEquityEur > 0) {
    const dailyLossPct = (context.dayStartEquityEur - context.currentEquityEur) / context.dayStartEquityEur;
    if (dailyLossPct >= config.maxDailyLossPct) {
      blockers.push("Límite de pérdida diaria alcanzado");
    }
  }

  if (context.peakEquityEur > 0) {
    const drawdownPct = (context.peakEquityEur - context.currentEquityEur) / context.peakEquityEur;
    if (drawdownPct >= config.maxDrawdownPct) {
      blockers.push("Límite de drawdown alcanzado");
    }
  }

  if (context.consecutiveTransportErrors >= config.maxConsecutiveTransportErrors) {
    blockers.push("Demasiados errores consecutivos de transporte");
  }

  if (context.lastMarketDataAt === null || now - context.lastMarketDataAt > config.maxMarketDataAgeMs) {
    blockers.push("Datos de mercado obsoletos o ausentes");
  }

  return { allowed: blockers.length === 0, blockers };
}
