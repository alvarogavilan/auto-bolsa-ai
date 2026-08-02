import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO PAPER performance forensics", () => {
  it("prioritizes current-engine evidence without hiding legacy losses", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Diagnóstico forense del rendimiento");
    expect(html).toContain("Motor actual · evidencia completa v1");
    expect(html).toContain("Histórico completo · contexto, no aprobación");
    expect(html).toContain("Calidad del motor actual");
    expect(html).toContain("Cierres actuales");
    expect(html).toContain("Ganadas / perdidas actuales");
    expect(html).toContain("Expectativa actual");
    expect(html).toContain("Profit factor actual");
    expect(html).toContain("Operaciones cerradas totales");
    expect(html).toContain("Históricas / legado");
    expect(html).toContain("Por causa de salida · histórico completo");
    expect(html).toContain("las operaciones históricas se conservan íntegramente");
  });

  it("requires a meaningful current-engine sample before any favorable interpretation", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("MIN_CURRENT_CLOSED_TRADES = 30");
    expect(html).toContain("MIN_CURRENT_PROFIT_FACTOR = 1.2");
    expect(html).toContain("Muestra mínima");
    expect(html).toContain("Progreso de muestra");
    expect(html).toContain("Muestra insuficiente");
    expect(html).toContain("una o varias victorias aisladas nunca permiten aprobar LIVE");
    expect(html).not.toContain("Motor actual: muestra provisional favorable");
  });

  it("keeps LIVE and real orders blocked", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
