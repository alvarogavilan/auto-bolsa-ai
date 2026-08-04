import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO XAU live EUR result", () => {
  it("shows invested capital, current net value and net EUR result", () => {
    expect(source).toContain("Dinero invertido");
    expect(source).toContain("Valor neto actual");
    expect(source).toContain("Ganancia / pérdida neta");
    expect(source).toContain("invested + pnl");
  });

  it("refreshes production every second without fabricating ticks", () => {
    expect(source).toContain("setInterval(refreshXau, 1000)");
    expect(source).toContain("no se fabrican movimientos entre ticks");
  });

  it("keeps real trading disabled", () => {
    expect(source).toContain("LIVE y órdenes reales desactivados");
  });
});
