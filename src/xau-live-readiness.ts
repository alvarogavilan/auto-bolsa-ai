export interface XauLiveInstrumentMetadata {
  broker: string;
  symbol: string;
  orderMinBase: number;
  lotDecimals: number;
  priceDecimals: number;
  supportsNativeStop: boolean;
  estimatedRoundTripCostPct: number;
  verifiedAt: number;
}

export interface XauLiveReadinessResult {
  ready: boolean;
  blockers: string[];
}

/**
 * XAU LIVE must never be enabled from a generic trading switch alone.
 * A broker-specific, recently verified gold instrument is mandatory.
 */
export function evaluateXauLiveReadiness(
  metadata: XauLiveInstrumentMetadata | null,
  now = Date.now(),
): XauLiveReadinessResult {
  const blockers: string[] = [];

  if (!metadata) {
    blockers.push("El broker configurado no tiene un instrumento XAU verificado para ejecución LIVE.");
    return { ready: false, blockers };
  }

  if (!metadata.broker.trim()) blockers.push("Broker XAU ausente.");
  if (!metadata.symbol.trim()) blockers.push("Símbolo XAU LIVE ausente.");
  if (!Number.isFinite(metadata.orderMinBase) || metadata.orderMinBase <= 0) blockers.push("Mínimo de orden XAU inválido.");
  if (!Number.isInteger(metadata.lotDecimals) || metadata.lotDecimals < 0) blockers.push("Precisión de volumen XAU inválida.");
  if (!Number.isInteger(metadata.priceDecimals) || metadata.priceDecimals < 0) blockers.push("Precisión de precio XAU inválida.");
  if (!metadata.supportsNativeStop) blockers.push("El instrumento XAU no ofrece stop nativo verificable.");
  if (!Number.isFinite(metadata.estimatedRoundTripCostPct) || metadata.estimatedRoundTripCostPct <= 0) {
    blockers.push("Costes reales XAU no verificados.");
  }
  if (!Number.isFinite(metadata.verifiedAt) || now - metadata.verifiedAt > 24 * 60 * 60 * 1_000) {
    blockers.push("Metadatos XAU LIVE caducados o no verificados en las últimas 24 horas.");
  }

  return { ready: blockers.length === 0, blockers };
}

export const CURRENT_XAU_LIVE_READINESS: XauLiveReadinessResult = evaluateXauLiveReadiness(null);
