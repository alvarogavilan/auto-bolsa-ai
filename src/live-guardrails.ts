// Puertas estructurales del ejecutor LIVE. Todas las comprobaciones son puras y
// deliberadamente redundantes: el interruptor `liveTradingEnabled` es la única que
// necesita fallar para bloquear cualquier envío, pero cada una se evalúa de forma
// independiente para que ningún cambio futuro pueda "olvidar" una sola puerta.

const EPSILON = 1e-9;

export interface LiveGuardrailConfig {
  liveTradingEnabled: boolean;
  maxOrderNotionalEur: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxConsecutiveTransportErrors: number;
  maxMarketDataAgeMs: number;
  /** Pares permitidos para operar en LIVE. Cualquier otro par se bloquea. */
  allowedPairs: readonly string[];
  /** Tolerancia relativa entre volumeBase × limitPrice y notionalEur declarado. */
  maxNotionalDeviationPct: number;
}

export type LiveOrderIntent = "open" | "close";

export interface LiveGuardrailContext {
  orderIntent: LiveOrderIntent;
  pair: string;
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
  hasActiveOrder: boolean;
  /** Cantidad realmente en inventario del activo (no un booleano). */
  inventoryQuantityBase: number;
  /** Cantidad ya reservada por una orden de cierre en curso. */
  inventoryReservedQuantityBase: number;
  /** Par al que corresponde el inventario actual, o null si no hay ninguno. */
  inventoryPair: string | null;
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
    allowedPairs: ["XBTEUR"],
    maxNotionalDeviationPct: 0.01,
    ...overrides,
  };
}

export function liveTradingEnabledFromEnv(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Validación de la intención en sí misma, independiente del estado del
 * ejecutor: números finitos y positivos, par permitido, y que
 * `volumeBase × limitPrice` sea coherente con el `notionalEur` declarado.
 */
export function validateOrderIntent(
  context: Pick<LiveGuardrailContext, "pair" | "volumeBase" | "limitPrice" | "notionalEur">,
  config: Pick<LiveGuardrailConfig, "allowedPairs" | "maxNotionalDeviationPct">,
): string[] {
  const blockers: string[] = [];

  if (!Number.isFinite(context.volumeBase) || context.volumeBase <= 0) {
    blockers.push("volumeBase debe ser un número finito y positivo");
  }
  if (!Number.isFinite(context.limitPrice) || context.limitPrice <= 0) {
    blockers.push("limitPrice debe ser un número finito y positivo");
  }
  if (!Number.isFinite(context.notionalEur) || context.notionalEur <= 0) {
    blockers.push("notionalEur debe ser un número finito y positivo");
  }
  if (!config.allowedPairs.includes(context.pair)) {
    blockers.push(`Par no permitido: ${context.pair}`);
  }

  if (
    Number.isFinite(context.volumeBase) && context.volumeBase > 0
    && Number.isFinite(context.limitPrice) && context.limitPrice > 0
    && Number.isFinite(context.notionalEur) && context.notionalEur > 0
  ) {
    const impliedNotional = context.volumeBase * context.limitPrice;
    const deviationPct = Math.abs(impliedNotional - context.notionalEur) / context.notionalEur;
    if (deviationPct > config.maxNotionalDeviationPct) {
      blockers.push(
        `volumeBase × limitPrice (${impliedNotional}) no coincide con notionalEur declarado (${context.notionalEur})`,
      );
    }
  }

  return blockers;
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

  blockers.push(...validateOrderIntent(context, config));

  const hasOpenPosition = context.inventoryQuantityBase > EPSILON;
  if (context.orderIntent === "open" && hasOpenPosition) {
    blockers.push("Ya existe una posición abierta (límite estructural de una sola posición)");
  }

  if (context.orderIntent === "close") {
    if (!hasOpenPosition) {
      blockers.push("No hay posición abierta que cerrar");
    } else {
      if (context.inventoryPair !== null && context.inventoryPair !== context.pair) {
        blockers.push(`La posición abierta es de ${context.inventoryPair}, no de ${context.pair}`);
      }
      const availableQuantityBase = context.inventoryQuantityBase - context.inventoryReservedQuantityBase;
      if (context.volumeBase > availableQuantityBase + EPSILON) {
        blockers.push("La venta solicitada supera el inventario real disponible del activo");
      }
    }
  }

  if (context.notionalEur > config.maxOrderNotionalEur) {
    blockers.push(
      `Tamaño solicitado ${context.notionalEur} EUR supera el máximo configurado ${config.maxOrderNotionalEur} EUR`,
    );
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
