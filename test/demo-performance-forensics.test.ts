import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO PAPER performance forensics", () => {
  it("exposes honest closed-trade quality metrics without changing trading", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Diagnóstico forense del rendimiento");
    expect(html).toContain("Muestra negativa: no apta para LIVE");
    expect(html).toContain("Tasa de acierto");
    expect(html).toContain("Expectativa por operación");
    expect(html).toContain("Profit factor");
    expect(html).toContain("Ganancia media");
    expect(html).toContain("Pérdida media");
    expect(html).toContain("Evidencia completa nueva");
    expect(html).toContain("Históricas / legado");
    expect(html).toContain("Por causa de salida");
    expect(html).toContain("No se alteran operaciones ni se ocultan pérdidas");
  });

  it("keeps LIVE and real orders blocked", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
