import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO XAU economic transparency", () => {
  it("shows exposure, quantity and percentages instead of ambiguous invested wording", () => {
    expect(source).toContain("Capital asignado / exposición");
    expect(source).toContain("Cantidad aproximada");
    expect(source).toContain("Movimiento favorable");
    expect(source).toContain("Resultado neto real");
    expect(source).toContain("xauPct");
  });

  it("explains the cost hurdle for small positions", () => {
    expect(source).toContain("0,05 € de costes equivalen al 0,5 %");
    expect(source).toContain("Los puntos del oro no son un porcentaje");
  });

  it("keeps real trading disabled", () => {
    expect(source).toContain("LIVE y órdenes reales desactivados");
  });
});
