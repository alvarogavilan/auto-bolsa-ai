import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO recovery cohort readiness", () => {
  it("shows legacy and corrected cohorts separately", async () => {
    const response = await demoDashboard();
    const html = await response.text();
    expect(html).toContain("Histórico anterior · cerradas");
    expect(html).toContain("Lógica corregida · cerradas");
    expect(html).toContain("PnL neto cohorte corregida");
  });

  it("keeps live blocked and exposes objective readiness gates", async () => {
    const response = await demoDashboard();
    const html = await response.text();
    expect(html).toContain("DINERO REAL BLOQUEADO");
    expect(html).toContain("5 cierres nuevos");
    expect(html).toContain("alguna ganadora neta");
    expect(html).toContain("PnL neto positivo");
    expect(html).toContain("Esto no activa LIVE automáticamente");
  });
});
