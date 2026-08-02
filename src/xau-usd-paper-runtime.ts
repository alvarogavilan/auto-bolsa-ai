import { evaluateXauUsdCabinet, type XauCabinetInput, type XauCabinetDecision } from "./xau-usd-specialist-cabinet";

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
}

export interface XauPaperInstruction {
  schemaVersion: "xau-usd-paper-instruction-v1";
  createdAt: number;
  market: "XAU/USD";
  mode: "paper";
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
  blockers: string[];
  liveTrading: false;
  realOrderSubmission: false;
}

const MAX_QUOTE_AGE_MS = 15_000;
const MIN_XAU_PAPER_BUDGET_EUR = 5;
const MAX_XAU_PAPER_BUDGET_EUR = 10;

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function buildXauUsdPaperInstruction(input: XauPaperRuntimeInput): XauPaperInstruction {
  const cabinetDecision = evaluateXauUsdCabinet(input.cabinet);
  const blockers = [...cabinetDecision.vetoes];
  const quoteAgeMs = Math.max(0, input.now - input.quote.observedAt);
  const bid = Number(input.quote.bid);
  const ask = Number(input.quote.ask);

  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask <= bid) {
    blockers.push("Cotización XAU/USD inválida o cruzada.");
  }
  if (quoteAgeMs > MAX_QUOTE_AGE_MS) blockers.push("Cotización XAU/USD caducada.");
  if (!input.quote.source.trim()) blockers.push("Fuente de cotización XAU/USD ausente.");

  const normalizedBudget = money(Math.max(0, Math.min(input.requestedBudgetEur, MAX_XAU_PAPER_BUDGET_EUR)));
  if (normalizedBudget < MIN_XAU_PAPER_BUDGET_EUR) blockers.push("Presupuesto XAU PAPER inferior al mínimo operativo de 5 €.");

  const action = cabinetDecision.bias === "long" ? "buy" : cabinetDecision.bias === "short" ? "sell" : "hold";
  const referencePrice = action === "buy" ? ask : action === "sell" ? bid : null;
  const invalidationPct = Math.max(0, input.cabinet.technical.distanceToInvalidationPct) / 100;
  const projectedMovePct = Math.max(0, input.cabinet.technical.projectedMovePct) / 100;
  const rewardRisk = invalidationPct > 0 ? projectedMovePct / invalidationPct : 0;

  let stopPrice: number | null = null;
  let initialTargetPrice: number | null = null;
  if (referencePrice !== null) {
    stopPrice = action === "buy"
      ? referencePrice * (1 - invalidationPct)
      : referencePrice * (1 + invalidationPct);
    initialTargetPrice = action === "buy"
      ? referencePrice * (1 + projectedMovePct)
      : referencePrice * (1 - projectedMovePct);
  }

  const allowed = cabinetDecision.allowed
    && blockers.length === 0
    && action !== "hold"
    && referencePrice !== null;

  return {
    schemaVersion: "xau-usd-paper-instruction-v1",
    createdAt: input.now,
    market: "XAU/USD",
    mode: "paper",
    action: allowed ? action : "hold",
    allowed,
    budgetEur: allowed ? normalizedBudget : 0,
    referencePrice: allowed ? money(referencePrice as number) : null,
    stopPrice: allowed ? money(stopPrice as number) : null,
    initialTargetPrice: allowed ? money(initialTargetPrice as number) : null,
    rewardRisk: money(rewardRisk),
    quoteAgeMs,
    quoteSource: input.quote.source,
    cabinetDecision,
    blockers,
    liveTrading: false,
    realOrderSubmission: false,
  };
}
