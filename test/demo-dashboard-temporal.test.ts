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

  it("keeps temporal evidence informational and excludes live controls", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Esta capa no cambia operaciones ni habilita dinero real");
    expect(html).not.toContain("Activar validación temporal");
    expect(html).not.toContain("Autorizar LIVE por validación");
  });

  it("publishes the report through the lab response without changing the executor", () => {
    const state = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(state).toContain("buildTemporalValidationReport");
    expect(state).toContain("temporalValidation");
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(index).toContain('url.pathname.startsWith("/api/live")');
  });
});
