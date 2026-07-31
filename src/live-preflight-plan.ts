import type { LivePairMetadata } from "./live-guardrails";
import type { LiveOrderPreflightIntent } from "./live-order-preflight";

export const DEFAULT_PREFLIGHT_NOTIONAL_EUR = 5;

export interface BuildPreflightBuyPlanInput {
  pair: string;
  askPrice: number;
  metadata: LivePairMetadata;
  costMinQuote: number;
  requestedNotionalEur?: number;
  maxNotionalEur?: number;
}

export interface ValidateOnlyBuyPlan {
  intent: LiveOrderPreflightIntent & { side: "buy" };
  source: {
    price: "kraken-public-ask";
    metadata: "kraken-public-assetpairs";
  };
  costMinQuote: number;
  maxNotionalEur: number;
  message: string;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function floorToDecimals(value: number, decimals: number): number {
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? Math.min(decimals, 12) : -1;
  if (safeDecimals < 0) throw new Error("lotDecimals inválido para construir el preflight");
  const factor = 10 ** safeDecimals;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
}

function roundToDecimals(value: number, decimals: number): number {
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? Math.min(decimals, 12) : -1;
  if (safeDecimals < 0) throw new Error("priceDecimals inválido para construir el preflight");
  const factor = 10 ** safeDecimals;
  return Math.round(value * factor) / factor;
}

/**
 * Construye una intención validate-only conservadora usando únicamente datos
 * públicos de Kraken. El volumen se redondea hacia abajo para no superar el
 * máximo y el precio se cuantiza a la precisión exacta del par.
 */
export function buildValidateOnlyBuyPlan(
  input: BuildPreflightBuyPlanInput,
): ValidateOnlyBuyPlan {
  if (!input.pair.trim()) throw new Error("Par vacío en el preflight");
  if (!positiveFinite(input.askPrice)) throw new Error("Ask público inválido para el preflight");
  if (!positiveFinite(input.metadata.orderMinBase)) throw new Error("ordermin inválido para el preflight");
  if (!Number.isInteger(input.metadata.lotDecimals) || input.metadata.lotDecimals < 0) {
    throw new Error("lotDecimals inválido para el preflight");
  }
  if (!Number.isInteger(input.metadata.priceDecimals) || input.metadata.priceDecimals < 0) {
    throw new Error("priceDecimals inválido para el preflight");
  }
  if (!Number.isFinite(input.costMinQuote) || input.costMinQuote < 0) {
    throw new Error("costmin inválido para el preflight");
  }

  const maxNotionalEur = input.maxNotionalEur ?? DEFAULT_PREFLIGHT_NOTIONAL_EUR;
  const requestedNotionalEur = input.requestedNotionalEur ?? DEFAULT_PREFLIGHT_NOTIONAL_EUR;
  if (!positiveFinite(maxNotionalEur) || maxNotionalEur > DEFAULT_PREFLIGHT_NOTIONAL_EUR) {
    throw new Error(`El máximo del preflight debe estar entre 0 y ${DEFAULT_PREFLIGHT_NOTIONAL_EUR} EUR`);
  }
  if (!positiveFinite(requestedNotionalEur)) throw new Error("Nocional solicitado inválido para el preflight");

  const budget = Math.min(requestedNotionalEur, maxNotionalEur);
  if (input.costMinQuote > budget) {
    throw new Error(`El mínimo de coste de Kraken (${input.costMinQuote}) supera el máximo del preflight (${budget})`);
  }

  const limitPrice = roundToDecimals(input.askPrice, input.metadata.priceDecimals);
  if (!positiveFinite(limitPrice)) throw new Error("El precio cuantizado del preflight no es válido");

  const volumeBase = floorToDecimals(budget / limitPrice, input.metadata.lotDecimals);
  if (!positiveFinite(volumeBase)) throw new Error("El presupuesto no permite un volumen positivo cuantizado");
  if (volumeBase < input.metadata.orderMinBase) {
    throw new Error(`El presupuesto no alcanza ordermin (${input.metadata.orderMinBase}) para ${input.pair}`);
  }

  const notionalEur = Number((volumeBase * limitPrice).toPrecision(15));
  if (!positiveFinite(notionalEur) || notionalEur > maxNotionalEur + 1e-9) {
    throw new Error("El nocional cuantizado supera el máximo del preflight");
  }
  if (notionalEur + 1e-9 < input.costMinQuote) {
    throw new Error(`El nocional cuantizado (${notionalEur}) queda por debajo de costmin (${input.costMinQuote})`);
  }

  return {
    intent: {
      pair: input.pair,
      side: "buy",
      volumeBase,
      limitPrice,
      notionalEur,
    },
    source: {
      price: "kraken-public-ask",
      metadata: "kraken-public-assetpairs",
    },
    costMinQuote: input.costMinQuote,
    maxNotionalEur,
    message: "Plan de compra límite construido con datos públicos actuales para validación sin ejecución.",
  };
}
