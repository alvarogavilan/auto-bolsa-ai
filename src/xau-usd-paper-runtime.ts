import { evaluateXauUsdCabinet, type XauCabinetInput, type XauCabinetDecision } from "./xau-usd-specialist-cabinet";

export type XauCycleKind = "decision" | "monitoring";

export interface XauLiveQuoteEvidence {
  bid: number;
  ask: number;
  observedAt: number;
  source: string;
}

export interface XauPaperRuntimeInput {
  now: number;
  cabinet: XauCabinetInput;
  quote: XauLiveQuoteEvidence;
  requestedBudgetEur: number;
  cycleKind?: XauCycleKind;
}

export interface XauPaperSizingEvidence {
  requestedMaximumEur: number;
  confidenceFactor: number;
  rewardRiskFactor: number;
  volatilityFactor: number;
  exposureHeadroomEur: number;
  selectedBudgetEur: number;
  rationale: string[];
}

export interface XauPaperInstruction {
  schemaVersion: "xau-usd-paper-instruction-v1";
  createdAt: number;
  market: "XAU/USD";
  mode: "paper";
  cycleKind?: XauCycleKind;
  action: "buy" | "sell" | "hold";
  allowed: boolean;
  budgetEur: number;
  referencePrice: number | null;
  stopPrice: number | null;
  initialTargetPrice: number | null;
  rewardRisk: number;
  quoteAgeMs: number;
  quoteSource: string;
  cabinetDecision: XauCabinetDecision;
  sizing: XauPaperSizingEvidence;
  blockers: string[];
  liveTrading: false;
  realOrderSubmission: false;
}

const MAX_QUOTE_AGE_MS = 15_000;
const MIN_XAU_PAPER_BUDGET_EUR = 5;
const MAX_XAU_PAPER_BUDGET_EUR = 30;
const MAX_XAU_AGGREGATE_EXPOSURE_PCT = 0.30;

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function calculateXauPaperBudget(
  input: Pick<XauPaperRuntimeInput, "requestedBudgetEur" | "cabinet">,
  cabinetDecision: XauCabinetDecision,
  rewardRisk: number,
): XauPaperSizingEvidence {
  const requestedMaximumEur = money(clamp(input.requestedBudgetEur, 0, MAX_XAU_PAPER_BUDGET_EUR));
  const confidenceFactor = clamp((cabinetDecision.consensusPct - 65) / 35, 0.25, 1);
  const rewardRiskFactor = clamp((rewardRisk - 1.5) / 2.5, 0.35, 1);
  const volatilityFactor = cabinetDecision.riskRegime === "normal" ? 1 : cabinetDecision.riskRegime === "elevated" ? 0.6 : 0;
  const maximumAggregateExposureEur = Math.max(0, input.cabinet.paperEquityEur * MAX_XAU_AGGREGATE_EXPOSURE_PCT);
  const exposureHeadroomEur = money(Math.max(0, maximumAggregateExposureEur - input.cabinet.openXauExposureEur));
  const rawBudget = requestedMaximumEur * confidenceFactor * rewardRiskFactor * volatilityFactor;
  const selectedBudgetEur = money(Math.min(requestedMaximumEur, exposureHeadroomEur, rawBudget));
  return {
    requestedMaximumEur,
    confidenceFactor: money(confidenceFactor),
    rewardRiskFactor: money(rewardRiskFactor),
    volatilityFactor: money(volatilityFactor),
    exposureHeadroomEur,
    selectedBudgetEur,
    rationale: [
      `Consenso aplicable: ${cabinetDecision.consensusPct.toFixed(2)} %`,
      `Asimetría proyectada: ${rewardRisk.toFixed(2)}R`,
      `Régimen de riesgo: ${cabinetDecision.riskRegime}`,
      `Exposición XAU disponible: ${exposureHeadroomEur.toFixed(2)} €`,
      "Dimensionado PAPER dinámico; LIVE y órdenes reales permanecen desactivados.",
    ],
  };
}

export function buildXauUsdPaperInstruction(input: XauPaperRuntimeInput): XauPaperInstruction {
  const cycleKind = input.cycleKind ?? (input.quote.source.toLowerCase().includes("fast proxy") ? "monitoring" : "decision");
  const cabinetDecision = evaluateXauUsdCabinet(input.cabinet);
  const blockers = [...cabinetDecision.vetoes];
  const quoteAgeMs = Math.max(0, input.now - input.quote.observedAt);
  const bid = Number(input.quote.bid);
  const ask = Number(input.quote.ask);

  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask <= bid) blockers.push("Cotización XAU/USD inválida o cruzada.");
  if (quoteAgeMs > MAX_QUOTE_AGE_MS) blockers.push("Cotización XAU/USD caducada.");
  if (!input.quote.source.trim()) blockers.push("Fuente de cotización XAU/USD ausente.");

  const action = cabinetDecision.bias === "long" ? "buy" : cabinetDecision.bias === "short" ? "sell" : "hold";
  const referencePrice = action === "buy" ? ask : action === "sell" ? bid : null;
  const invalidationPct = Math.max(0, input.cabinet.technical.distanceToInvalidationPct) / 100;
  const projectedMovePct = Math.max(0, input.cabinet.technical.projectedMovePct) / 100;
  const rewardRisk = invalidationPct > 0 ? projectedMovePct / invalidationPct : 0;
  const sizing = calculateXauPaperBudget(input, cabinetDecision, rewardRisk);
  if (sizing.selectedBudgetEur < MIN_XAU_PAPER_BUDGET_EUR) blockers.push("El dimensionado dinámico XAU PAPER queda por debajo del mínimo operativo de 5 €.");

  let stopPrice: number | null = null;
  let initialTargetPrice: number | null = null;
  if (referencePrice !== null) {
    stopPrice = action === "buy" ? referencePrice * (1 - invalidationPct) : referencePrice * (1 + invalidationPct);
    initialTargetPrice = action === "buy" ? referencePrice * (1 + projectedMovePct) : referencePrice * (1 - projectedMovePct);
  }

  const allowed = cycleKind === "decision" && cabinetDecision.allowed && blockers.length === 0 && action !== "hold" && referencePrice !== null;

  return {
    schemaVersion: "xau-usd-paper-instruction-v1",
    createdAt: input.now,
    market: "XAU/USD",
    mode: "paper",
    cycleKind,
    action: allowed ? action : "hold",
    allowed,
    budgetEur: allowed ? sizing.selectedBudgetEur : 0,
    referencePrice: allowed ? money(referencePrice as number) : null,
    stopPrice: allowed ? money(stopPrice as number) : null,
    initialTargetPrice: allowed ? money(initialTargetPrice as number) : null,
    rewardRisk: money(rewardRisk),
    quoteAgeMs,
    quoteSource: input.quote.source,
    cabinetDecision,
    sizing,
    blockers,
    liveTrading: false,
    realOrderSubmission: false,
  };
}