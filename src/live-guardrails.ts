// Puertas estructurales del ejecutor LIVE. Todas las comprobaciones son puras y
// deliberadamente redundantes: el interruptor `liveTradingEnabled` es la única que
// necesita fallar para bloquear cualquier envío, pero cada una se evalúa de forma
// independiente para que ningún cambio futuro pueda "olvidar" una sola puerta.

const EPSILON = 1e-9;

/**
 * Metadatos reales de Kraken para un par (endpoint público `AssetPairs`):
 * cantidad base mínima por orden y precisión (decimales) de volumen y precio.
 * Los valores por defecto (`defaultLiveGuardrailConfig`) son de ejemplo y
 * deben sincronizarse contra `AssetPairs` antes de cualquier piloto real; no
 * se puede confiar en ellos como fuente de verdad de Kraken.
 */
export interface LivePairMetadata {
  orderMinBase: number;
  lotDecimals: number;
  priceDecimals: number;
}

export interface LiveGuardrailConfig {
  liveTradingEnabled: boolean;
  maxOrderNotionalEur: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxConsecutiveTransportErrors: number;
  maxMarketDataAgeMs: number;
  /** Pares permitidos, con sus metadatos reales de Kraken. Cualquier otro par se bloquea. */
  pairMetadata: Readonly<Record<string, LivePairMetadata>>;
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
  /** Verdadero si queda inventario o reconciliación sin resolver desde una parada previa. */
  manualLiquidationPending: boolean;
}

export interface LiveGuardrailResult {
  allowed: boolean;
  blockers: string[];
}

export const DEFAULT_MAX_ORDER_NOTIONAL_EUR = 5;

/**
 * Valores de ejemplo, no verificados contra el endpoint público `AssetPairs`
 * en el momento de escribir esto. Cualquier despliegue real debe sustituirlos
 * por los valores vigentes antes de un piloto manual.
 */
export const DEFAULT_PAIR_METADATA: Readonly<Record<string, LivePairMetadata>> = {
  XBTEUR: { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 },
};

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
    pairMetadata: DEFAULT_PAIR_METADATA,
    maxNotionalDeviationPct: 0.01,
    ...overrides,
  };
}

export function liveTradingEnabledFromEnv(value: string | undefined): boolean {
  return value === "true";
}

/** Verdadero si `value` no cambia al redondearlo a `decimals` decimales (dentro de un margen de coma flotante). */
export function isQuantized(value: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(value * factor) / factor - value) < 1e-9;
}

/** Cuantiza `value` a `decimals` decimales (redondeo estándar, no truncamiento). */
export function quantizeToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Validación de la intención en sí misma, independiente del estado del
 * ejecutor: números finitos y positivos, par permitido con sus metadatos
 * reales de Kraken (mínimo y precisión), y que `volumeBase × limitPrice` sea
 * coherente con el `notionalEur` declarado.
 */
export function validateOrderIntent(
  context: Pick<LiveGuardrailContext, "pair" | "volumeBase" | "limitPrice" | "notionalEur">,
  config: Pick<LiveGuardrailConfig, "pairMetadata" | "maxNotionalDeviationPct">,
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

  const metadata = config.pairMetadata[context.pair];
  if (!metadata) {
    blockers.push(`Par no permitido: ${context.pair}`);
  } else if (Number.isFinite(context.volumeBase) && context.volumeBase > 0) {
    if (context.volumeBase < metadata.orderMinBase) {
      blockers.push(
        `volumeBase ${context.volumeBase} inferior al mínimo de Kraken para ${context.pair} (${metadata.orderMinBase})`,
      );
    }
    if (!isQuantized(context.volumeBase, metadata.lotDecimals)) {
      blockers.push(`volumeBase ${context.volumeBase} no está cuantizado a ${metadata.lotDecimals} decimales (lot_decimals)`);
    }
    if (Number.isFinite(context.limitPrice) && context.limitPrice > 0 && !isQuantized(context.limitPrice, metadata.priceDecimals)) {
      blockers.push(`limitPrice ${context.limitPrice} no está cuantizado a ${metadata.priceDecimals} decimales (pair_decimals)`);
    }
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

  if (context.manualLiquidationPending) {
    blockers.push("Liquidación manual pendiente tras una parada de emergencia");
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
