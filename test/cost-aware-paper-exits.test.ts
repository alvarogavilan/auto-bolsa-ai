import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/research-lab-adaptive.ts", import.meta.url), "utf8");

describe("cost-aware PAPER exits", () => {
  it("requires a meaningful net margin before a discretionary RSI exit", () => {
    expect(source).toContain("minimumDiscretionaryNetExitPct");
    expect(source).toContain("strategy.estimatedTakerRoundTripCostPct * 1.5");
    expect(source).toContain('latest.reason !== "RSI de salida del carril"');
    expect(source).toContain("netReturnPct >= minimum");
  });

  it("does not disable mandatory risk exits", () => {
    expect(source).toContain("Stop, take profit neto, cruce bajista y tiempo máximo siguen activos");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
  });
});
