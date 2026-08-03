import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/index-paper-capital.ts", "utf8");

describe("GET /api/paper/economics", () => {
  it("derives economic metrics from immutable lab history", () => {
    expect(source).toContain('path === "/api/paper/economics"');
    expect(source).toContain('new URL("/api/lab", request.url)');
    expect(source).toContain("derivePaperEconomicPerformance");
    expect(source).toContain('schemaVersion: "paper-economic-performance-v1"');
    expect(source).toContain("minimumMeaningfulNetProfitEur: 0.5");
  });

  it("remains PAPER-only and never exposes real execution", () => {
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrderSubmission: false");
    expect(source).not.toContain("AddOrder");
  });

  it("returns no-store and a fail-soft blocker when lab data is unavailable", () => {
    expect(source).toContain('"Cache-Control": "no-store"');
    expect(source).toContain("available: false");
    expect(source).toContain("Lab HTTP");
  });
});
