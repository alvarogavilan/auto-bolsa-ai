import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const marketPanel = readFileSync(new URL("../src/demo-market-universe.ts", import.meta.url), "utf8");
const xauPanel = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO market universe observability", () => {
  it("reads the real Kraken EUR universe and shows eligibility and blockers", () => {
    expect(marketPanel).toContain("fetch('/api/markets'");
    expect(marketPanel).toContain("Elegibles ahora");
    expect(marketPanel).toContain("exclusionReasons");
    expect(marketPanel).toContain("fastEligible");
    expect(marketPanel).toContain("intradayEligible");
    expect(marketPanel).toContain("swingEligible");
  });

  it("integrates into the existing single demo rendering pipeline without enabling LIVE", () => {
    expect(xauPanel).toContain("DEMO_MARKET_UNIVERSE_STYLE");
    expect(xauPanel).toContain("DEMO_MARKET_UNIVERSE_CODE");
    expect(marketPanel).not.toContain("LIVE_TRADING_ENABLED");
    expect(marketPanel).not.toContain("realOrderSubmission: true");
  });
});
