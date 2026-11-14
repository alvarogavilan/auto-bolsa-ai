import { describe, expect, it } from "vitest";
import { planXauPersistence, runPersistentXauPaperCycle, XAU_PAPER_LEDGER_KEY } from "../src/xau-usd-persistent-orchestrator";
import { createXauPaperPositionBook, XAU_PAPER_POSITION_KEY, type XauPaperPosition, type XauPaperPositionBook } from "../src/xau-usd-paper-position";

function book(open: Partial<XauPaperPosition> | null, closed = 0): XauPaperPositionBook {
  const base = createXauPaperPositionBook();
  return {
    ...base,
    open: open ? { id: "p1", stopPrice: 3960, targetPrice: 4100, trailingActive: false, ...open } as XauPaperPosition : null,
    metrics: { ...base.metrics, opened: open ? 1 + closed : closed, closed },
  };
}

describe("XAU persistence budget (Durable Objects free tier)", () => {
  it("writes nothing for a fast sample when nothing is open", () => {
    expect(planXauPersistence(true, book(null), book(null))).toEqual({ ledger: false, positionBook: false });
  });

  it("writes nothing for a fast sample that only moves the mark price", () => {
    expect(planXauPersistence(true, book({}), book({ lastMarkPrice: 4010 }))).toEqual({ ledger: false, positionBook: false });
  });

  it("persists a fast sample that changes the protection or closes the position", () => {
    expect(planXauPersistence(true, book({}), book({ stopPrice: 3990, trailingActive: true })).positionBook).toBe(true);
    expect(planXauPersistence(true, book({}), book(null, 1)).positionBook).toBe(true);
  });

  it("persists decisions: ledger always, book only with a position or an event", () => {
    expect(planXauPersistence(false, book(null), book(null))).toEqual({ ledger: true, positionBook: false });
    expect(planXauPersistence(false, book({}), book({}))).toEqual({ ledger: true, positionBook: true });
    expect(planXauPersistence(false, book(null), book({}))).toEqual({ ledger: true, positionBook: true });
  });

  it("a flat fast sample performs zero storage writes end to end", async () => {
    const puts: string[] = [];
    const store = { get: async () => null, put: async (key: string) => { puts.push(key); } };
    const now = Date.UTC(2026, 10, 14, 12, 0, 0);
    const quote = { bid: 4000, ask: 4000.5, observedAt: now, source: "test" };
    const cabinet = {
      symbol: "XAU/USD", session: "london",
      technical: { marketStructureBias: "neutral", liquidityBias: "neutral", trendBias: "neutral", momentumBias: "neutral", spreadPct: 0.01, volatilityPct: 0.4, distanceToInvalidationPct: 0.5, projectedMovePct: 1 },
      macro: { dxyBiasForGold: "neutral", realYieldsBiasForGold: "neutral", centralBankBias: "neutral", inflationBias: "neutral", geopoliticalBias: "neutral", sourcesAvailable: 4, sourcesFresh: 4, highImpactEventWithinMinutes: null },
      openXauExposureEur: 0, paperEquityEur: 100,
    };
    const monitoring = await runPersistentXauPaperCycle(store, { now, quote, cabinet, cycleKind: "monitoring" } as never);
    expect(monitoring.persisted).toBe(false);
    expect(puts).toEqual([]);
    const decision = await runPersistentXauPaperCycle(store, { now: now + 1, quote: { ...quote, observedAt: now + 1 }, cabinet, cycleKind: "decision" } as never);
    expect(decision.persisted).toBe(true);
    expect(puts).toEqual([XAU_PAPER_LEDGER_KEY]);
    expect(puts).not.toContain(XAU_PAPER_POSITION_KEY);
  });
});
