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
  new Script(`${body}\nlab=${JSON.stringify(lab)};strategies=[];renderDecisionTimeline();`).runInContext(context);
  return elements.get("decisionTimelineList")?.innerHTML ?? "";
}

describe("Priority 4: Decisiones never shows empty/invented entries", () => {
  it("shows a single explicit empty state instead of inventing decisions or votes when there is no evaluated entry", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const output = renderWithLab(script, {});
    expect(output).toContain("Aún no hay operaciones evaluadas por el comité");
    expect(output).not.toContain("Evaluación");
    expect(output).not.toContain("Sin decisión");
    expect(output).not.toContain("0 votos registrados");
  });

  it("renders symbol, lane, timestamp, verdict, outcome and real committee votes for a real entry", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      committeeImpact: {
        recentEntries: [
          {
            entryTradeId: "t1",
            symbol: "XBT/EUR",
            lane: "fast",
            entryAt: 1_800_000_000_000,
            verdict: "candidate",
            outcome: "profit",
            pnlEur: 0.42,
            votes: [
              { id: "risk", role: "Riesgo", vote: "approve", hardVeto: false, reason: "Drawdown controlado" },
              { id: "evidence", role: "Evidencia", vote: "observe", hardVeto: false, reason: "Muestra insuficiente" },
            ],
          },
        ],
      },
    };

    const output = renderWithLab(script, lab);
    expect(output).toContain("XBT/EUR");
    expect(output).toContain("Rápida");
    expect(output).toContain("candidate");
    expect(output).toContain("Ganadora");
    expect(output).toContain("0,42");
    expect(output).toContain("Riesgo");
    expect(output).toContain("approve");
    expect(output).toContain("Evidencia");
    expect(output).toContain("observe");
    expect(output).toContain("2 votos registrados");
    expect(output).not.toContain("Evaluación");
    expect(output).not.toContain("Sin decisión");
    expect(output).not.toContain("0 votos registrados");
  });

  it("never fabricates a vote count when an entry has no votes recorded", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      committeeImpact: {
        recentEntries: [
          { entryTradeId: "t2", symbol: "ETH/EUR", lane: "swing", entryAt: 1_800_000_000_000, verdict: "observe", outcome: "open" },
        ],
      },
    };

    const output = renderWithLab(script, lab);
    expect(output).toContain("ETH/EUR");
    expect(output).toContain("0 votos registrados");
    expect(output).toContain("Sin votos conservados");
  });
});
