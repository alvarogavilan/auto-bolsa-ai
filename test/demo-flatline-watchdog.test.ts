import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO flatline watchdog", () => {
  it("measures real PAPER trade age separately from engine analysis", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Actividad real del laboratorio");
    expect(html).toContain("Última operación PAPER");
    expect(html).toContain("Última compra");
    expect(html).toContain("Último cierre");
    expect(html).toContain("Último análisis del motor");
    expect(html).toContain("Separa operaciones PAPER de ciclos de análisis");
    expect(html).toContain("tradeTimestamps");
    expect(html).not.toContain("Tiempo sin actividad reciente");
  });

  it("detects prolonged inactivity without forcing PAPER trades", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("ALERTA DE BLOQUEO");
    expect(html).toContain("PLANO PROLONGADO EXPLICADO");
    expect(html).toContain("Umbral sin operaciones");
    expect(html).toContain("El motor continúa analizando");
  });

  it("keeps LIVE and real orders blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("LIVE y órdenes reales permanecen bloqueados");
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
