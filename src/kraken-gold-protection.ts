export interface KrakenGoldProtectionInput {
  entryPrice: number;
  currentPrice: number;
  highestPrice: number;
  tickSize: number;
  initialStopPct: number;
  breakEvenTriggerPct: number;
  trailingTriggerPct: number;
  trailingDistancePct: number;
  roundTripFeePct: number;
  previousStopPrice: number | null;
}

export interface KrakenGoldProtectionPlan {
  initialStopPrice: number;
  breakEvenPrice: number;
  trailingCandidatePrice: number | null;
  effectiveStopPrice: number;
  mode: "initial" | "break-even" | "trailing";
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function floorToTick(value: number, tickSize: number): number {
  return Math.floor((value + 1e-12) / tickSize) * tickSize;
}

function clampBelowMarket(value: number, currentPrice: number, tickSize: number): number {
  return Math.min(value, floorToTick(currentPrice - tickSize, tickSize));
}

/**
 * Política fail-closed para una posición larga PAXG/EUR.
 * El stop solo puede moverse a favor y siempre permanece al menos un tick
 * por debajo del mercado observado.
 */
export function buildKrakenGoldProtectionPlan(
  input: KrakenGoldProtectionInput,
): KrakenGoldProtectionPlan {
  requirePositive("entryPrice", input.entryPrice);
  requirePositive("currentPrice", input.currentPrice);
  requirePositive("highestPrice", input.highestPrice);
  requirePositive("tickSize", input.tickSize);
  requirePositive("initialStopPct", input.initialStopPct);
  requirePositive("breakEvenTriggerPct", input.breakEvenTriggerPct);
  requirePositive("trailingTriggerPct", input.trailingTriggerPct);
  requirePositive("trailingDistancePct", input.trailingDistancePct);
  if (!Number.isFinite(input.roundTripFeePct) || input.roundTripFeePct < 0) {
    throw new Error("roundTripFeePct must be non-negative");
  }
  if (input.highestPrice + 1e-12 < input.currentPrice) {
    throw new Error("highestPrice cannot be below currentPrice");
  }

  const initialStopPrice = floorToTick(
    input.entryPrice * (1 - input.initialStopPct),
    input.tickSize,
  );
  const breakEvenPrice = floorToTick(
    input.entryPrice * (1 + input.roundTripFeePct),
    input.tickSize,
  );

  const gainFromEntry = (input.currentPrice - input.entryPrice) / input.entryPrice;
  const peakGain = (input.highestPrice - input.entryPrice) / input.entryPrice;
  const breakEvenArmed = gainFromEntry >= input.breakEvenTriggerPct;
  const trailingArmed = peakGain >= input.trailingTriggerPct;

  const trailingCandidatePrice = trailingArmed
    ? floorToTick(input.highestPrice * (1 - input.trailingDistancePct), input.tickSize)
    : null;

  let candidate = initialStopPrice;
  let mode: KrakenGoldProtectionPlan["mode"] = "initial";
  if (breakEvenArmed) {
    candidate = Math.max(candidate, breakEvenPrice);
    mode = "break-even";
  }
  if (trailingCandidatePrice !== null && trailingCandidatePrice > candidate) {
    candidate = trailingCandidatePrice;
    mode = "trailing";
  }
  if (input.previousStopPrice !== null) {
    requirePositive("previousStopPrice", input.previousStopPrice);
    candidate = Math.max(candidate, input.previousStopPrice);
  }

  const effectiveStopPrice = clampBelowMarket(candidate, input.currentPrice, input.tickSize);
  if (!(effectiveStopPrice > 0) || effectiveStopPrice >= input.currentPrice) {
    throw new Error("No safe stop can be placed below current market");
  }
  if (input.previousStopPrice !== null && effectiveStopPrice + 1e-12 < input.previousStopPrice) {
    throw new Error("Protection would widen existing risk");
  }

  return {
    initialStopPrice,
    breakEvenPrice,
    trailingCandidatePrice,
    effectiveStopPrice,
    mode,
  };
}
