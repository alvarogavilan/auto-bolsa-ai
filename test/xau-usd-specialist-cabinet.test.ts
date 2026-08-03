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
  it("authorizes a strongly aligned setup with fresh macro evidence", () => {
    const decision = evaluateXauUsdCabinet(healthyInput());
    expect(decision.allowed).toBe(true);
    expect(decision.bias).toBe("long");
    expect(decision.consensusPct).toBeGreaterThanOrEqual(72);
    expect(decision.liveTrading).toBe(false);
  });

  it("allows only a unanimous high-asymmetry technical shadow setup when macro is unavailable", () => {
    const input = healthyInput();
    input.macro = {
      dxyBiasForGold: "neutral",
      realYieldsBiasForGold: "neutral",
      centralBankBias: "neutral",
      inflationBias: "neutral",
      geopoliticalBias: "neutral",
      highImpactEventWithinMinutes: null,
      sourcesAvailable: 1,
      sourcesFresh: 1,
    };
    const decision = evaluateXauUsdCabinet(input);
    expect(decision.allowed).toBe(true);
    expect(decision.consensusPct).toBe(100);
    expect(decision.reasons.join(" ")).toContain("PAPER técnico estricto");
    expect(decision.liveTrading).toBe(false);
  });

  it("blocks the shadow profile when one technical expert disagrees", () => {
    const input = healthyInput();
    input.macro.sourcesFresh = 1;
    input.macro.sourcesAvailable = 1;
    input.macro.dxyBiasForGold = "neutral";
    input.macro.realYieldsBiasForGold = "neutral";
    input.macro.centralBankBias = "neutral";
    input.macro.inflationBias = "neutral";
    input.macro.geopoliticalBias = "neutral";
    input.technical.momentumBias = "short";
    const decision = evaluateXauUsdCabinet(input);
    expect(decision.allowed).toBe(false);
    expect(decision.vetoes.join(" ")).toContain("perfil técnico PAPER estricto");
  });

  it("blocks imminent macro events and excessive exposure", () => {
    const input = healthyInput();
    input.macro.highImpactEventWithinMinutes = 10;
    input.openXauExposureEur = 10;
    const decision = evaluateXauUsdCabinet(input);
    expect(decision.allowed).toBe(false);
    expect(decision.riskRegime).toBe("event-lockout");
    expect(decision.vetoes.join(" ")).toContain("evento macro");
    expect(decision.vetoes.join(" ")).toContain("Exposición XAU máxima");
  });

  it("remains exclusive and PAPER only", () => {
    const input = healthyInput();
    input.symbol = "BTC/EUR";
    expect(evaluateXauUsdCabinet(input).allowed).toBe(false);
    expect(buildXauUsdCabinetManifest()).toMatchObject({
      market: "XAU/USD",
      exclusive: true,
      priority: "maximum",
      paperFallback: "strict-technical-shadow",
      executionMode: "paper-only",
      liveTrading: false,
    });
  });
});
