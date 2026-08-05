import { describe, expect, it } from "vitest";
import { evaluateXauLiveReadiness } from "../src/xau-live-readiness";

describe("XAU LIVE broker readiness", () => {
  it("blocks LIVE when no verified broker instrument exists", () => {
    const result = evaluateXauLiveReadiness(null, 1_000);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("no tiene un instrumento XAU verificado");
  });

  it("blocks stale or stop-less metadata", () => {
    const result = evaluateXauLiveReadiness({
      broker: "test-broker",
      symbol: "XAUUSD",
      orderMinBase: 0.01,
      lotDecimals: 2,
      priceDecimals: 2,
      supportsNativeStop: false,
      estimatedRoundTripCostPct: 0.002,
      verifiedAt: 1,
    }, 2 * 24 * 60 * 60 * 1_000);

    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("stop nativo");
    expect(result.blockers.join(" ")).toContain("caducados");
  });

  it("allows only complete, fresh broker metadata", () => {
    const now = 10_000;
    const result = evaluateXauLiveReadiness({
      broker: "verified-broker",
      symbol: "XAUUSD",
      orderMinBase: 0.01,
      lotDecimals: 2,
      priceDecimals: 2,
      supportsNativeStop: true,
      estimatedRoundTripCostPct: 0.002,
      verifiedAt: now,
    }, now);

    expect(result).toEqual({ ready: true, blockers: [] });
  });
});
