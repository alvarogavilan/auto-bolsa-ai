import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("temporal validation in the DEMO app", () => {
  it("renders chronological training and posterior evidence", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Validación temporal");
    expect(html).toContain("¿Se mantiene fuera del tramo inicial?");
    expect(html).toContain("60 % inicial");
    expect(html).toContain("40 % posterior");
    expect(html).toContain("Bloques positivos");
    expect(html).toContain("Concentración mejor ganancia");
    expect(html).toContain("renderTemporalValidation");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
    expect(match?.[1]).not.toMatch(/^\+/m);
  });

  it("keeps temporal evidence informational and excludes live controls", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Esta capa no cambia operaciones ni habilita dinero real");
    expect(html).not.toContain("Activar validación temporal");
    expect(html).not.toContain("Autorizar LIVE por validación");
  });

  it("publishes temporal evidence before the frozen forward layer", () => {
    const impact = readFileSync(join(ROOT, "src/research-lab-state-impact.ts"), "utf8");
    const forward = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const indexCore = readFileSync(join(ROOT, "src/index-core.ts"), "utf8");

    expect(impact).toContain("buildTemporalValidationReport");
    expect(impact).toContain("temporalValidation");
    expect(forward).toContain('from "./research-lab-state-impact"');
    expect(indexCore).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(indexCore).toContain('url.pathname.startsWith("/api/live")');
  });
});
