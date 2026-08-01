import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("cost and sequence stress in the DEMO app", () => {
  it("renders all adverse-cost and sequence metrics", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Pruebas de estrés");
    expect(html).toContain("¿Sobrevive a costes peores?");
    expect(html).toContain("Resultado combinado");
    expect(html).toContain("Drawdown combinado");
    expect(html).toContain("Racha perdedora");
    expect(html).toContain("Peor bloque de 5");
    expect(html).toContain("renderStress");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
    expect(match?.[1]).not.toMatch(/^\+/m);
  });

  it("keeps stress results informational and never exposes a live action", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Esta prueba no cambia operaciones ni habilita LIVE");
    expect(html).not.toContain("Operar pese al estrés");
    expect(html).not.toContain("Autorizar orden real");
  });

  it("publishes stress before the frozen forward observer without modifying live routes", () => {
    const impact = readFileSync(join(ROOT, "src/research-lab-state-impact.ts"), "utf8");
    const forward = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const indexCore = readFileSync(join(ROOT, "src/index-core.ts"), "utf8");

    expect(impact).toContain("buildCostSequenceStressReport");
    expect(impact).toContain("costSequenceStress");
    expect(forward).toContain('from "./research-lab-state-impact"');
    expect(indexCore).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(indexCore).toContain('url.pathname.startsWith("/api/live")');
  });
});
