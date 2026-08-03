import { describe, expect, it } from "vitest";
import {
  assessPaperEconomicOutcome,
  minimumMeaningfulPaperProfitEur,
} from "../src/paper-economic-outcome";

describe("global PAPER economic outcome policy", () => {
  it("does not count cent-level positive results as wins", () => {
    for (const pnl of [0.0052, 0.14, 0.3291, 0.49]) {
      const assessment = assessPaperEconomicOutcome(pnl, 10);
      expect(assessment.outcome).toBe("micro-win");
      expect(assessment.countsAsWin).toBe(false);
      expect(assessment.economicallyMeaningful).toBe(false);
    }
  });

  it("requires at least 0.50 EUR net on 5, 7.50 and 10 EUR allocations", () => {
    expect(minimumMeaningfulPaperProfitEur(5)).toBe(0.5);
    expect(minimumMeaningfulPaperProfitEur(7.5)).toBe(0.5);
    expect(minimumMeaningfulPaperProfitEur(10)).toBe(0.5);
    expect(assessPaperEconomicOutcome(0.5, 10).countsAsWin).toBe(true);
  });

  it("preserves losses and flat outcomes without falsifying PnL", () => {
    expect(assessPaperEconomicOutcome(-0.0462, 5).outcome).toBe("loss");
    expect(assessPaperEconomicOutcome(0, 10).outcome).toBe("flat");
    expect(assessPaperEconomicOutcome(-0.0462, 5).netPnlEur).toBe(-0.0462);
  });
});
