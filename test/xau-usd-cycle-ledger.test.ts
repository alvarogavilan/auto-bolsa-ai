import { describe, expect, it } from "vitest";
import { appendXauPaperCycle, createXauPaperCycleLedger } from "../src/xau-usd-cycle-ledger";
import type { XauPaperInstruction } from "../src/xau-usd-paper-runtime";

function instruction(allowed: boolean, blockers: string[] = []): XauPaperInstruction {
  const budgetEur = allowed ? 10 : 0;
  return {
    schemaVersion: "xau-usd-paper-instruction-v1",
    createdAt: 1_000,
    market: "XAU/USD",
    mode: "paper",
    action: allowed ? "buy" : "hold",
    allowed,
    budgetEur,
    referencePrice: allowed ? 2400 : null,
    stopPrice: allowed ? 2390 : null,
    initialTargetPrice: allowed ? 2420 : null,
    rewardRisk: 2,
    quoteAgeMs: 100,
    quoteSource: "test-feed",
    cabinetDecision: {
      schemaVersion: "xau-usd-specialist-cabinet-v1",
      symbol: "XAU/USD",
      allowed,
      bias: allowed ? "long" : "neutral",
      consensusPct: allowed ? 80 : 40,
      riskRegime: "normal",
      votes: [], vetoes: blockers, reasons: [], liveTrading: false,
    },
    sizing: {
      requestedMaximumEur: 10,
      confidenceFactor: allowed ? 0.8 : 0.25,
      rewardRiskFactor: 0.35,
      volatilityFactor: 1,
      exposureHeadroomEur: 30,
      selectedBudgetEur: budgetEur,
      rationale: [allowed ? "Fixture aprobada." : "Fixture bloqueada."],
    },
    blockers,
    liveTrading: false,
    realOrderSubmission: false,
  };
}

describe("XAU/USD PAPER cycle ledger", () => {
  it("records approved and blocked cycles without enabling real execution", () => {
    let ledger = createXauPaperCycleLedger();
    ledger = appendXauPaperCycle(ledger, instruction(true));
    ledger = appendXauPaperCycle(ledger, instruction(false, ["Cotización XAU/USD caducada."]));
    expect(ledger.metrics).toMatchObject({ cycles: 2, approved: 1, blocked: 1, staleQuotes: 1 });
    expect(ledger.cycles).toHaveLength(2);
    expect(ledger.cycles[0]?.realOrderSubmission).toBe(false);
    expect(ledger.liveTrading).toBe(false);
  });

  it("separates macro, consensus and invalid quote blockers", () => {
    let ledger = createXauPaperCycleLedger();
    ledger = appendXauPaperCycle(ledger, instruction(false, ["Bloqueo por evento macro de alto impacto inminente."]));
    ledger = appendXauPaperCycle(ledger, instruction(false, ["Consenso XAU insuficiente: 45 %."]));
    ledger = appendXauPaperCycle(ledger, instruction(false, ["Cotización XAU/USD inválida o cruzada."]));
    expect(ledger.metrics).toMatchObject({ macroLockouts: 1, weakConsensus: 1, invalidQuotes: 1 });
  });
});
