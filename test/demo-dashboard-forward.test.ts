import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("frozen forward experiment in DEMO dashboard", () => {
  it("shows the forward-only cohort and its blockers", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Experimento forward congelado");
    expect(html).toContain("Prueba fuera de muestra");
    expect(html).toContain("Operaciones futuras");
    expect(html).toContain("Parámetros");
    expect(html).toContain("Superan referencia");
    expect(html).toContain("researchReviewBlockers");
    expect(html).toContain("renderFrozenForward");
  });

  it("explains baseline initialization and configuration drift", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Comienza próximo ciclo");
    expect(html).toContain("El historial anterior no contará");
    expect(html).toContain("Cohorte contaminada");
    expect(html).toContain("Deriva detectada");
  });

  it("never presents the forward experiment as live authority", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("no habilita LIVE");
    expect(html).toContain("Aun así, no habilita LIVE");
    expect(html).not.toContain("Activar LIVE");
    expect(html).not.toContain("Enviar orden real");
    expect(html).not.toContain("/api/pilot/submit");
  });

  it("includes forward status in the technical details without exposing secrets", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("frozenForwardExperiment:lab.frozenForwardExperiment");
    expect(html).toContain("frozenForwardStatus:lab.frozenForwardStatus");
    expect(html).not.toContain("KRAKEN_API_SECRET");
    expect(html).not.toContain("ADMIN_TOKEN");
  });
});
