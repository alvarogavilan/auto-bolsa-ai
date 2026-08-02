import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO single PAPER treasury", () => {
  it("uses the 100 EUR treasury as the visual source of truth", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("const TARGET=100;");
    expect(html).toContain("Tesorería PAPER única de 100 €");
    expect(html).toContain("singleSourceOfTruth === true");
    expect(html).toContain("current.equityEur");
    expect(html).toContain("current.freeCashEur");
    expect(html).toContain("current.committedCapitalEur");
    expect(html).not.toContain("Cuenta equivalente de 50 €");
  });

  it("labels inherited micropositions without deleting or resizing them", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Posición heredada");
    expect(html).toContain("inferior al mínimo vigente de 5 €");
    expect(html).toContain("Se conserva por integridad histórica");
  });

  it("keeps LIVE and real orders explicitly blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
