import { describe, expect, it } from "vitest";
import { buildXauUsdCabinetManifest, evaluateXauUsdCabinet, type XauCabinetInput } from "../src/xau-usd-specialist-cabinet";

function healthyInput(): XauCabinetInput {
  return {
    symbol: "XAU/USD",
    session: "overlap",
    technical: {
      trendBias: "long",
      marketStructureBias: "long",
      liquidityBias: "long",
      momentumBias: "long",
      volatilityPct: 0.8,
      spreadPct: 0.02,
      distanceToInvalidationPct: 0.4,
      projectedMovePct: 1.2,
    },
    macro: {
      dxyBiasForGold: "long",
      realYieldsBiasForGold: "long",
      centralBankBias: "long",
      inflationBias: "long",
      geopoliticalBias: "long",
      highImpactEventWithinMinutes: 90,
      sourcesAvailable: 6,
      sourcesFresh: 6,
    },
    openXauExposureEur: 0,
    paperEquityEur: 100,
  };
}

describe("XAU/USD specialist cabinet", () => {
  it("authorizes only a strongly aligned XAU setup with fresh macro evidence", () => {
    const decision = evaluateXauUsdCabinet(healthyInput());
    expect(decision.allowed).toBe(true);
    expect(decision.symbol).toBe("XAU/USD");
    expect(decision.bias).toBe("long");
    expect(decision.consensusPct).toBeGreaterThanOrEqual(72);
    expect(decision.votes.length).toBeGreaterThanOrEqual(9);
    expect(decision.liveTrading).toBe(false);
  });

  it("blocks an imminent high-impact macro event even with technical alignment", () => {
    const input = healthyInput();
    input.macro.highImpactEventWithinMinutes = 10;
    const decision = evaluateXauUsdCabinet(input);
    expect(decision.allowed).toBe(false);
    expect(decision.riskRegime).toBe("event-lockout");
    expect(decision.vetoes.join(" ")).toContain("evento macro");
  });

  it("blocks stale macro evidence, weak asymmetry and excessive XAU exposure", () => {
    const input = healthyInput();
    input.macro.sourcesFresh = 2;
    input.technical.projectedMovePct = 0.5;
    input.openXauExposureEur = 10;
    const decision = evaluateXauUsdCabinet(input);
    expect(decision.allowed).toBe(false);
    expect(decision.vetoes.join(" ")).toContain("macro fresca insuficiente");
    expect(decision.vetoes.join(" ")).toContain("Asimetría XAU insuficiente");
    expect(decision.vetoes.join(" ")).toContain("Exposición XAU máxima");
  });

  it("is structurally exclusive to XAU/USD and remains PAPER only", () => {
    const input = healthyInput();
    input.symbol = "BTC/EUR";
    const decision = evaluateXauUsdCabinet(input);
    const manifest = buildXauUsdCabinetManifest();
    expect(decision.allowed).toBe(false);
    expect(decision.vetoes.join(" ")).toContain("exclusivo para XAU/USD");
    expect(manifest).toMatchObject({ market: "XAU/USD", exclusive: true, priority: "maximum", executionMode: "paper-only", liveTrading: false });
  });
});
