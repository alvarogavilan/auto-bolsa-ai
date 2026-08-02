import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standaloneDemoDashboard } from "../src/demo-dashboard-standalone";

function renderWithLab(script: string, lab: unknown): Record<string, string> {
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
  new Script(
    `${body}\nlab=${JSON.stringify(lab)};strategies=[];\nglobalThis.__probe={temporal:renderTemporalValidation(),stress:renderStress(),evidence:renderPaperEvidence(),impact:renderCommitteeImpact(),forward:renderFrozenForward()};`,
  ).runInContext(context);
  return (context as { __probe: Record<string, string> }).__probe;
}

describe("Priority 3: Validación never shows real evidence as zero", () => {
  it("reads temporal validation from the real nested report shape, not invented flat fields", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      temporalValidation: {
        schemaVersion: "paper-temporal-validation-report-v1",
        entries: [],
        leaderboard: [
          {
            strategyId: "fast:XBTEUR",
            symbol: "XBT/EUR",
            training: { netPnlEur: -0.5 },
            validation: { netPnlEur: -0.6719, positivePnlConcentrationPct: 42.5 },
            positiveRollingFolds: 1,
            evaluatedRollingFolds: 3,
          },
        ],
      },
    };

    const probe = renderWithLab(script, lab);
    expect(probe.temporal).toContain("-0,50");
    expect(probe.temporal).toContain("-0,67");
    expect(probe.temporal).toContain("1 / 3");
    expect(probe.temporal).toContain("42,5");
    expect(probe.temporal).not.toContain(">0,00 €<");
  });

  it("shows an explicit 'muestra insuficiente' state instead of zeros when there is no report", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const probe = renderWithLab(script, {});
    expect(probe.temporal).toContain("Muestra insuficiente");
    expect(probe.temporal).not.toContain("0,00 €");
    expect(probe.stress).toContain("Muestra insuficiente");
    expect(probe.impact).toContain("Muestra insuficiente");
  });

  it("reads cost sequence stress from combinedScenario, not invented flat fields", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      costSequenceStress: {
        entries: [
          {
            strategyId: "fast:XBTEUR",
            symbol: "XBT/EUR",
            combinedScenario: { netPnlEur: -1.1719, maxDrawdownPct: 0.045, longestLosingStreak: 5, worstFiveTradePnlEur: -0.8 },
          },
        ],
        leaderboard: [],
      },
    };

    const probe = renderWithLab(script, lab);
    expect(probe.stress).toContain("-1,17");
    expect(probe.stress).toContain("4,50");
    expect(probe.stress).toContain(">5<");
  });

  it("reads the paper evidence ledger's real field names (totalMovements, maxMovementsPerStrategy)", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = { paperEvidenceLedger: { totalMovements: 27, maxMovementsPerStrategy: 1000 } };
    const probe = renderWithLab(script, lab);
    expect(probe.evidence).toContain(">27<");
    expect(probe.evidence).toContain("1000");
  });

  it("reads committee impact from hardVeto*/entriesObserved, not invented flat fields", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      committeeImpact: {
        entriesObserved: 12,
        hardVetoLossesAvoidedEur: 3.2,
        hardVetoGainsMissedEur: 0.4,
        hypotheticalHardVetoNetBenefitEur: 2.8,
      },
    };
    const probe = renderWithLab(script, lab);
    expect(probe.impact).toContain(">12<");
    expect(probe.impact).toContain("3,20");
    expect(probe.impact).toContain("0,40");
    expect(probe.impact).toContain("2,80");
  });

  it("reads frozen forward from the report object, not the unrelated status object", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      frozenForwardExperiment: {
        forwardClosedTrades: 8,
        parametersFrozen: true,
        strategiesOutperformingBestPassive: 2,
        researchReviewBlockers: ["Aún no han transcurrido 14 días forward"],
      },
      frozenForwardStatus: { startsOnNextValidCycle: false },
    };
    const probe = renderWithLab(script, lab);
    expect(probe.forward).toContain(">8<");
    expect(probe.forward).toContain("Congelados");
    expect(probe.forward).toContain(">2<");
    expect(probe.forward).toContain(">1<");
  });
});
