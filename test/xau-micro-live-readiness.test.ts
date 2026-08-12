import { describe, expect, it } from "vitest";
import { calculateXauMicroLiveReadiness } from "../src/xau-live-readiness";

function status(now: number, overrides: Record<string, unknown> = {}) {
  return {
    metrics: { decisionCycles: 621, approved: 33, blocked: 588 },
    cycles: [
      {
        observedAt: now - 30_000,
        outcome: "blocked",
        instruction: { cycleKind: "decision" },
      },
    ],
    positionBook: {
      open: null,
      closed: [{}, {}],
      metrics: { closed: 2, realizedPnlEur: 0.086568 },
      treasury: {
        initialCapitalEur: 100,
        realizedPnlEur: 0.086568,
        equityEur: 100.086568,
        equityCurve: [
          { equityEur: 100 },
          { equityEur: 99.99 },
          { equityEur: 100.086568 },
        ],
      },
    },
    ...overrides,
  };
}

describe("XAU micro-live readiness", () => {
  it("accepts the dedicated gold evidence for a <=5 EUR execution pilot", () => {
    const now = 1_800_000_000_000;
    const result = calculateXauMicroLiveReadiness(status(now), now);
    expect(result.eligible).toBe(true);
    expect(result.fullScaleEligible).toBe(false);
    expect(result.pilotMaximumOrderNotionalEur).toBe(5);
    expect(result.closedTrades).toBe(2);
    expect(result.realizedPnlEur).toBeCloseTo(0.086568);
  });

  it("fails closed when XAU loses money", () => {
    const now = 1_800_000_000_000;
    const base = status(now);
    const book = base.positionBook as Record<string, unknown>;
    const treasury = book.treasury as Record<string, unknown>;
    treasury.realizedPnlEur = -0.1;
    treasury.equityEur = 99.9;
    const result = calculateXauMicroLiveReadiness(base, now);
    expect(result.eligible).toBe(false);
    expect(result.checks.positiveRealizedPnl).toBe(false);
    expect(result.checks.capitalPreserved).toBe(false);
  });

  it("fails closed on stale decisions or an open PAPER position", () => {
    const now = 1_800_000_000_000;
    const stale = status(now);
    stale.cycles[0]!.observedAt = now - 181_000;
    expect(calculateXauMicroLiveReadiness(stale, now).eligible).toBe(false);

    const open = status(now);
    (open.positionBook as Record<string, unknown>).open = { id: "paper-open" };
    const result = calculateXauMicroLiveReadiness(open, now);
    expect(result.eligible).toBe(false);
    expect(result.checks.paperAccountFlat).toBe(false);
  });
});
