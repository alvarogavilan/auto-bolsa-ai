export type LiveExecutionSide = "buy" | "sell";

export interface LiveTradeExecution {
  tradeId: string;
  exchangeOrderId: string;
  pair: string;
  side: LiveExecutionSide;
  timestampSeconds: number;
  price: number;
  costQuote: number;
  feeQuote: number;
  volumeBase: number;
  maker: boolean | null;
}

export interface ExpectedOrderExecution {
  exchangeOrderId: string;
  acceptedPairCodes: readonly string[];
  side: LiveExecutionSide;
  volumeExecutedBase: number;
  averagePrice: number | null;
  lotDecimals: number;
  priceDecimals: number;
}

export interface FillEvidenceSummary {
  tradeIds: string[];
  tradeCount: number;
  volumeBase: number;
  costQuote: number;
  feeQuote: number;
  averagePrice: number | null;
  makerCount: number;
  takerCount: number;
  unknownLiquidityCount: number;
  earliestTimestampSeconds: number | null;
  latestTimestampSeconds: number | null;
}

export type FillEvidenceStatus = "consistent" | "inconsistent" | "unknown";

export interface FillEvidenceResult {
  status: FillEvidenceStatus;
  reason: string;
  summary: FillEvidenceSummary;
}

const EMPTY_SUMMARY: FillEvidenceSummary = {
  tradeIds: [],
  tradeCount: 0,
  volumeBase: 0,
  costQuote: 0,
  feeQuote: 0,
  averagePrice: null,
  makerCount: 0,
  takerCount: 0,
  unknownLiquidityCount: 0,
  earliestTimestampSeconds: null,
  latestTimestampSeconds: null,
};

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function sameExecution(a: LiveTradeExecution, b: LiveTradeExecution): boolean {
  return a.exchangeOrderId === b.exchangeOrderId
    && a.pair === b.pair
    && a.side === b.side
    && a.timestampSeconds === b.timestampSeconds
    && a.price === b.price
    && a.costQuote === b.costQuote
    && a.feeQuote === b.feeQuote
    && a.volumeBase === b.volumeBase
    && a.maker === b.maker;
}

function round(value: number, decimals = 12): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function volumeTolerance(lotDecimals: number): number {
  const safeDecimals = Number.isInteger(lotDecimals) && lotDecimals >= 0 ? Math.min(lotDecimals, 12) : 8;
  return Math.max(1e-12, 0.5 * 10 ** -safeDecimals);
}

function priceTolerance(priceDecimals: number, expectedAverage: number): number {
  const safeDecimals = Number.isInteger(priceDecimals) && priceDecimals >= 0 ? Math.min(priceDecimals, 12) : 5;
  const absolute = 0.5 * 10 ** -safeDecimals;
  const relative = Math.abs(expectedAverage) * 1e-9;
  return Math.max(1e-12, absolute, relative);
}

export function reconcileFillEvidence(
  expected: ExpectedOrderExecution,
  executions: readonly LiveTradeExecution[],
  coverageComplete: boolean,
): FillEvidenceResult {
  if (!coverageComplete) {
    return {
      status: "unknown",
      reason: "El historial de ejecuciones no está completo; no se puede certificar la orden.",
      summary: { ...EMPTY_SUMMARY },
    };
  }

  const acceptedPairs = new Set(expected.acceptedPairCodes);
  const unique = new Map<string, LiveTradeExecution>();
  for (const execution of executions) {
    if (execution.exchangeOrderId !== expected.exchangeOrderId) continue;
    const prior = unique.get(execution.tradeId);
    if (prior && !sameExecution(prior, execution)) {
      return {
        status: "inconsistent",
        reason: `El tradeId ${execution.tradeId} aparece repetido con datos contradictorios.`,
        summary: { ...EMPTY_SUMMARY },
      };
    }
    if (!prior) unique.set(execution.tradeId, execution);
  }

  const matching = [...unique.values()].sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return a.tradeId.localeCompare(b.tradeId);
  });

  for (const execution of matching) {
    if (!execution.tradeId || !execution.exchangeOrderId) {
      return { status: "inconsistent", reason: "Existe una ejecución sin identificadores verificables.", summary: { ...EMPTY_SUMMARY } };
    }
    if (!acceptedPairs.has(execution.pair)) {
      return {
        status: "inconsistent",
        reason: `La ejecución ${execution.tradeId} pertenece al par inesperado ${execution.pair}.`,
        summary: { ...EMPTY_SUMMARY },
      };
    }
    if (execution.side !== expected.side) {
      return {
        status: "inconsistent",
        reason: `La ejecución ${execution.tradeId} tiene lado ${execution.side}, esperado ${expected.side}.`,
        summary: { ...EMPTY_SUMMARY },
      };
    }
    if (!Number.isFinite(execution.timestampSeconds) || execution.timestampSeconds <= 0
      || !Number.isFinite(execution.price) || execution.price <= 0
      || !Number.isFinite(execution.volumeBase) || execution.volumeBase <= 0
      || !finiteNonNegative(execution.costQuote)
      || !finiteNonNegative(execution.feeQuote)) {
      return {
        status: "inconsistent",
        reason: `La ejecución ${execution.tradeId} contiene importes, volumen o fecha inválidos.`,
        summary: { ...EMPTY_SUMMARY },
      };
    }
  }

  let volumeBase = 0;
  let costQuote = 0;
  let feeQuote = 0;
  let makerCount = 0;
  let takerCount = 0;
  let unknownLiquidityCount = 0;
  for (const execution of matching) {
    volumeBase += execution.volumeBase;
    costQuote += execution.costQuote;
    feeQuote += execution.feeQuote;
    if (execution.maker === true) makerCount += 1;
    else if (execution.maker === false) takerCount += 1;
    else unknownLiquidityCount += 1;
  }

  const summary: FillEvidenceSummary = {
    tradeIds: matching.map((execution) => execution.tradeId),
    tradeCount: matching.length,
    volumeBase: round(volumeBase),
    costQuote: round(costQuote),
    feeQuote: round(feeQuote),
    averagePrice: volumeBase > 0 ? round(costQuote / volumeBase) : null,
    makerCount,
    takerCount,
    unknownLiquidityCount,
    earliestTimestampSeconds: matching[0]?.timestampSeconds ?? null,
    latestTimestampSeconds: matching.at(-1)?.timestampSeconds ?? null,
  };

  const volTolerance = volumeTolerance(expected.lotDecimals);
  if (expected.volumeExecutedBase <= volTolerance) {
    if (summary.volumeBase > volTolerance) {
      return {
        status: "inconsistent",
        reason: `El historial contiene ${summary.volumeBase} ejecutado, pero la orden remota declara cero.`,
        summary,
      };
    }
    return { status: "consistent", reason: "La orden no tiene volumen ejecutado y no aparecen fills.", summary };
  }

  if (matching.length === 0) {
    return {
      status: "unknown",
      reason: "La orden declara volumen ejecutado, pero TradesHistory todavía no aporta ningún fill.",
      summary,
    };
  }

  if (Math.abs(summary.volumeBase - expected.volumeExecutedBase) > volTolerance) {
    return {
      status: "inconsistent",
      reason: `El volumen de fills (${summary.volumeBase}) no coincide con la orden (${expected.volumeExecutedBase}).`,
      summary,
    };
  }

  if (expected.averagePrice === null || !Number.isFinite(expected.averagePrice) || expected.averagePrice <= 0) {
    return {
      status: "unknown",
      reason: "Hay fills, pero la orden remota no aporta un precio medio válido para contrastarlos.",
      summary,
    };
  }

  const averageTolerance = priceTolerance(expected.priceDecimals, expected.averagePrice);
  if (summary.averagePrice === null || Math.abs(summary.averagePrice - expected.averagePrice) > averageTolerance) {
    return {
      status: "inconsistent",
      reason: `El precio medio de fills (${summary.averagePrice}) no coincide con la orden (${expected.averagePrice}).`,
      summary,
    };
  }

  return {
    status: "consistent",
    reason: "Volumen y precio medio respaldados por fills individuales completos.",
    summary,
  };
}
