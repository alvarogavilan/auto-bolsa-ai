import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO XAU gross, costs, net and stop state", () => {
  it("shows gross profit, estimated costs, net result and net break-even separately", () => {
    expect(source).toContain("Beneficio bruto");
    expect(source).toContain("Costes estimados");
    expect(source).toContain("Ganancia / pérdida neta");
    expect(source).toContain("Break-even neto");
    expect(source).toContain("grossUnrealizedPnlEur");
    expect(source).toContain("estimatedRoundTripCostEur");
    expect(source).toContain("netBreakEvenPrice");
  });

  it("does not describe an inherited reduced stop as active trailing or protected profit", () => {
    expect(source).toContain("STOP REDUCIDO · AÚN SIN BENEFICIO NETO");
    expect(source).toContain("Beneficio neto protegido");
    expect(source).toContain("no se presenta como beneficio protegido");
  });

  it("keeps LIVE and real orders disabled", () => {
    expect(source).toContain("LIVE y órdenes reales desactivados");
  });
});
