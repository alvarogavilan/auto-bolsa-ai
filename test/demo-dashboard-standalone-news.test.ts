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
  new Script(`${body}\nlab=${JSON.stringify(lab)};strategies=[];renderNews();`).runInContext(context);
  return elements.get("news")?.innerHTML ?? "";
}

describe("Priority 6: Noticias prioritizes market-relevant signals and shows an explicit source count", () => {
  it("shows an explicit empty state instead of zeros when no news report is available", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const output = renderWithLab(script, {});
    expect(output).toContain("No calculado");
    expect(output).not.toContain("0/0 fuentes");
  });

  it("ranks a Fed/dollar/rates signal above an unrelated, higher-impact-score press release", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      newsIntelligence: {
        sourceStatus: [
          { id: "a", label: "A", available: true, items: 1, latencyMs: 10, error: null },
          { id: "b", label: "B", available: true, items: 1, latencyMs: 10, error: null },
        ],
        signals: [
          {
            id: "s1",
            source: "Casa Blanca",
            title: "Nuevo nombramiento en una agencia sin relación con mercados",
            impactScore: 70,
            confidence: 0.7,
            direction: "neutral",
            assets: [],
            topics: ["political-speech"],
            corroboratingSources: 1,
            urgency: "normal",
            reasons: ["Fuente primaria: Casa Blanca"],
          },
          {
            id: "s2",
            source: "Reserva Federal",
            title: "La Fed manteniene los tipos de interés sin cambios",
            impactScore: 55,
            confidence: 0.8,
            direction: "risk-off",
            assets: ["USD"],
            topics: ["monetary-policy"],
            corroboratingSources: 2,
            urgency: "high",
            reasons: ["Fuente primaria: Reserva Federal", "Tema detectado: monetary-policy"],
          },
        ],
      },
    };

    const output = renderWithLab(script, lab);
    const fedIndex = output.indexOf("La Fed manteniene");
    const unrelatedIndex = output.indexOf("Nuevo nombramiento");
    expect(fedIndex).toBeGreaterThanOrEqual(0);
    expect(unrelatedIndex).toBeGreaterThanOrEqual(0);
    expect(fedIndex).toBeLessThan(unrelatedIndex);
    expect(output).toContain("2/2 fuentes");
    expect(output).toContain("Activos afectados");
    expect(output).toContain("USD");
    expect(output).toContain("Corroboración");
  });

  it("deduplicates repeated coverage of the same story, keeping only the highest-impact instance", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      newsIntelligence: {
        sourceStatus: [{ id: "a", label: "A", available: true, items: 2, latencyMs: 10, error: null }],
        signals: [
          { id: "s1", source: "A", title: "El BCE sube los tipos de interés medio punto", impactScore: 40, confidence: 0.7, direction: "risk-off", assets: ["EUR"], topics: ["monetary-policy"], corroboratingSources: 1, urgency: "normal", reasons: [] },
          { id: "s2", source: "A", title: "El BCE sube los tipos de interés medio punto", impactScore: 65, confidence: 0.75, direction: "risk-off", assets: ["EUR"], topics: ["monetary-policy"], corroboratingSources: 1, urgency: "high", reasons: [] },
        ],
      },
    };

    const output = renderWithLab(script, lab);
    const occurrences = output.split("El BCE sube los tipos de interés medio punto").length - 1;
    expect(occurrences).toBe(1);
    expect(output).toContain("impacto 65/100");
  });

  it("never trades solely on news: states it can only adjust or veto PAPER entries", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = { newsIntelligence: { sourceStatus: [], signals: [] } };
    const output = renderWithLab(script, lab);
    expect(output).toContain("nunca ejecuta");
  });
});
