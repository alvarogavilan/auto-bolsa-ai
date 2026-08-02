import { describe, expect, it } from "vitest";
import { buildMarketProductIntelligence } from "../src/market-product-intelligence";

describe("asset-family market specialists", () => {
  it("declares a dedicated specialist for every requested market family", () => {
    const report = buildMarketProductIntelligence(123);
    const families = report.specialists.map((specialist) => specialist.family);

    expect(report.generatedAt).toBe(123);
    expect(report.coverage.declaredFamilies).toBe(7);
    expect(families).toEqual(expect.arrayContaining([
      "crypto",
      "metals",
      "energy",
      "indices",
      "forex",
      "equities",
      "etfs",
    ]));
    expect(report.specialists.every((specialist) => specialist.requiredSignals.length >= 5)).toBe(true);
    expect(report.specialists.every((specialist) => specialist.dominantRisks.length >= 3)).toBe(true);
  });

  it("activates only data-supported PAPER families and keeps external markets observational", () => {
    const report = buildMarketProductIntelligence();
    const crypto = report.specialists.find((specialist) => specialist.family === "crypto");
    const metals = report.specialists.find((specialist) => specialist.family === "metals");
    const energy = report.specialists.find((specialist) => specialist.family === "energy");

    expect(crypto?.dataAvailability).toBe("native-kraken");
    expect(crypto?.paperAuthority).toBe("active");
    expect(metals?.dataAvailability).toBe("tokenized-proxy");
    expect(metals?.paperAuthority).toBe("active");
    expect(energy?.dataAvailability).toBe("external-feed-required");
    expect(energy?.paperAuthority).toBe("observe-only");
    expect(report.coverage.nativeOrProxyFamilies).toBe(2);
    expect(report.coverage.externalFeedFamilies).toBe(5);
  });

  it("ranks opportunities without forcing trades or increasing risk for volatility", () => {
    const report = buildMarketProductIntelligence();

    expect(report.dynamicSelection.enabledForResearch).toBe(true);
    expect(report.dynamicSelection.requiresComparableLiveData).toBe(true);
    expect(report.dynamicSelection.mayForceTrade).toBe(false);
    expect(report.dynamicSelection.mayIncreaseRiskForVolatility).toBe(false);
    expect(report.dynamicSelection.treasuryRetainsSizingAuthority).toBe(true);
    expect(report.specialists.every((specialist) => specialist.mayTradeLive === false)).toBe(true);
    expect(report.liveTrading).toBe(false);
    expect(report.policy.realOrdersDisabled).toBe(true);
  });
});
