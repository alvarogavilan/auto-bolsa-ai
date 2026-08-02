import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO operation dossiers", () => {
  it("renders the complete PAPER dossier department from the single source of truth", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Expedientes completos");
    expect(html).toContain("state.strategies[].trades");
    expect(html).toContain("GANADORA SIGNIFICATIVA");
    expect(html).toContain("MICROGANANCIA");
    expect(html).toContain("Costes totales");
    expect(html).toContain("Motivo de entrada");
    expect(html).toContain("Motivo de salida");
  });

  it("keeps the feature read-only and PAPER-only", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("fetch('/api/lab', { cache: 'no-store' })");
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
