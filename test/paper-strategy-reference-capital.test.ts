import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/research-lab.ts", import.meta.url), "utf8");

describe("PAPER strategy reference capital", () => {
  it("initializes every new strategy with the 100 EUR PAPER reference", () => {
    expect(source).toContain("initialCashEur: 100");
    expect(source).toContain("cashEur: 100");
    expect(source).toContain("equityEur: 100");
    expect(source).toContain("peakEquityEur: 100");
    expect(source).toContain("independentVirtualCapitalPerStrategyEur: 100");
    expect(source).not.toContain("initialCashEur: 50");
    expect(source).not.toContain("independentVirtualCapitalPerStrategyEur: 50");
  });

  it("keeps the laboratory PAPER-only", () => {
    expect(source).toContain("mode: \"paper\"");
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("eligibleForLiveReview: false");
  });
});
