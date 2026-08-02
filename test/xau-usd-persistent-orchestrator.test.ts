import { describe, expect, it } from "vitest";
import { runPersistentXauPaperCycle, type XauPaperStateStore } from "../src/xau-usd-persistent-orchestrator";
import type { XauPaperRuntimeInput } from "../src/xau-usd-paper-runtime";

class MemoryStore implements XauPaperStateStore {
  value: string | null = null;
  puts = 0;
  async get(): Promise<string | null> { return this.value; }
  async put(_key: string, value: string): Promise<void> { this.value = value; this.puts += 1; }
}

function input(now = 1_000): XauPaperRuntimeInput {
  return {
    now,
    requestedBudgetEur: 10,
    quote: { bid: 2399.8, ask: 2400, observedAt: now - 100, source: "test-feed" },
    cabinet: {
      symbol: "XAU/USD",
      session: "overlap",
      technical: {
        trendBias: "long", marketStructureBias: "long", liquidityBias: "long", momentumBias: "long",
        volatilityPct: 0.8, spreadPct: 0.02, distanceToInvalidationPct: 0.4, projectedMovePct: 1.2,
      },
      macro: {
        dxyBiasForGold: "long", realYieldsBiasForGold: "long", centralBankBias: "long",
        inflationBias: "long", geopoliticalBias: "long", highImpactEventWithinMinutes: 90,
        sourcesAvailable: 6, sourcesFresh: 6,
      },
      openXauExposureEur: 0,
      paperEquityEur: 100,
    },
  };
}

describe("persistent XAU/USD PAPER orchestrator", () => {
  it("persists an approved cycle and restores the ledger", async () => {
    const store = new MemoryStore();
    const first = await runPersistentXauPaperCycle(store, input());
    expect(first.persisted).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.ledger.metrics).toMatchObject({ cycles: 1, approved: 1 });
    const second = await runPersistentXauPaperCycle(store, input(2_000));
    expect(second.ledger.metrics).toMatchObject({ cycles: 2, approved: 2 });
    expect(store.puts).toBe(2);
  });

  it("does not duplicate an identical cycle", async () => {
    const store = new MemoryStore();
    await runPersistentXauPaperCycle(store, input());
    const duplicate = await runPersistentXauPaperCycle(store, input());
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.persisted).toBe(false);
    expect(duplicate.ledger.metrics.cycles).toBe(1);
    expect(store.puts).toBe(1);
  });

  it("recovers safely from corrupted persisted state", async () => {
    const store = new MemoryStore();
    store.value = "not-json";
    const result = await runPersistentXauPaperCycle(store, input());
    expect(result.ledger.metrics.cycles).toBe(1);
    expect(result.liveTrading).toBe(false);
    expect(result.realOrderSubmission).toBe(false);
  });
});
