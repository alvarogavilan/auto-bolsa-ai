import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO flatline watchdog", () => {
  it("detects prolonged inactivity without forcing PAPER trades", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Vigilancia de inactividad");
    expect(html).toContain("ALERTA DE BLOQUEO");
    expect(html).toContain("PLANO PROLONGADO EXPLICADO");
    expect(html).toContain("Umbral de revisión");
    expect(html).toContain("no fuerza operaciones");
  });

  it("keeps LIVE and real orders blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("LIVE y órdenes reales permanecen bloqueados");
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
