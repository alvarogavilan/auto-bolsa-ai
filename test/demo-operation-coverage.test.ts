import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO operation explanation coverage", () => {
  it("shows per-operation explanation coverage and indicator completeness", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Cobertura de indicadores de entrada");
    expect(html).toContain("Indicadores de entrada");
    expect(html).toContain("No persistidos en esta operación; pendiente para nuevas entradas");
    expect(html).toContain("No se inventan indicadores históricos");
    expect(html).toContain("dossierCoverage(operation)");
  });

  it("remains read-only and keeps LIVE blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("fetch('/api/lab', { cache: 'no-store' })");
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
