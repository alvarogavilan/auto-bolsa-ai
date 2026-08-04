import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO XAU PAPER treasury", () => {
  it("shows persistent treasury and equity-curve evidence", () => {
    expect(source).toContain("Tesorería XAU persistida");
    expect(source).toContain("committedCapitalEur");
    expect(source).toContain("equityEur");
    expect(source).toContain("equityCurve");
    expect(source).toContain("migratedExistingPosition");
  });

  it("keeps real trading disabled", () => {
    expect(source).toContain("LIVE y órdenes reales desactivados");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
  });
});
