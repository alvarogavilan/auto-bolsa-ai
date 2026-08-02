import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standaloneDemoDashboard } from "../src/demo-dashboard-standalone";

function renderWithLab(script: string, lab: unknown): string {
  const body = script.slice(0, script.indexOf("document.querySelectorAll('.tab')"));
  const elements = new Map<string, { innerHTML: string }>();
  const context = createContext({
    document: {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, { innerHTML: "" });
        return elements.get(id);
      },
    },
    history: {},
    performance: {},
    Intl,
    Number,
    Array,
    String,
    Math,
    Date,
  });
  new Script(`${body}\nlab=${JSON.stringify(lab)};strategies=[];renderEvidence();`).runInContext(context);
  return elements.get("evidence")?.innerHTML ?? "";
}

describe("Priority 3/7: Evidencia renders one merged panel, not a competing overwrite", () => {
  it("shows the recovery cohort alongside the paper evidence ledger, committee impact and frozen forward — none discarded", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    // A second, legacy script used to fetch /api/lab again and replace the
    // whole #evidence panel with only the recovery-cohort markup, silently
    // discarding the paper evidence ledger, committee impact and frozen
    // forward sections rendered here. There must be exactly one render path
    // for this tab now, and it must include all four sections together.
    const lab = {
      recoveryCohort: { startedAt: 1_800_000_000_000, legacy: { closedTrades: 12, wins: 3, losses: 9 }, correctedLogic: { closedTrades: 6, wins: 2, losses: 4, netPnlEur: 0.42 } },
      paperEvidenceLedger: { totalMovements: 27, maxMovementsPerStrategy: 3 },
      committeeImpact: { entriesObserved: 4, hardVetoLossesAvoidedEur: 1.2, hardVetoGainsMissedEur: 0.3, hypotheticalHardVetoNetBenefitEur: 0.9 },
      frozenForwardExperiment: { forwardClosedTrades: 2, parametersFrozen: true, strategiesOutperformingBestPassive: 1, researchReviewBlockers: [] },
    };

    const output = renderWithLab(script, lab);
    expect(output).toContain("Cohorte de recuperación");
    expect(output).toContain("Archivo de evidencia PAPER");
    expect(output).toContain("Impacto medido del comité");
    expect(output).toContain("Experimento forward congelado");
    expect(output).toContain("27");
  });
});
