import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO zero-position diagnostics", () => {
  it("renders a quantitative explanation for zero open positions", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Por qué hay ");
    expect(html).toContain("Mercados EUR descubiertos");
    expect(html).toContain("Compatibles con capital");
    expect(html).toContain("Decisiones clasificadas");
    expect(html).toContain("Sin señal técnica válida");
    expect(html).toContain("REVISAR BLOQUEO");
    expect(html).toContain("PLANO EXPLICADO");
  });

  it("is observational only and keeps real trading blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("No relaja filtros ni cambia operaciones");
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
