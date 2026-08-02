import { describe, expect, it } from "vitest";
import { globalPaperLosingStreak } from "../src/paper-entry-treasury-gate";
import type { ResearchLabState } from "../src/research-lab";

function stateWithDistributedCloses(pnls: number[]): ResearchLabState {
  return {
    schemaVersion: "multi-horizon-paper-lab-v1",
    version: "0.17.0-paper",
    mode: "paper",
    liveTrading: false,
    cycles: 1,
    lastCycleAt: Date.now(),
    strategies: pnls.map((pnlEur, index) => ({
      id: `strategy-${index}`,
      trades: [{
        id: `sell-${index}`,
        side: "sell" as const,
        timestamp: Date.now() - index * 1_000,
        price: 100,
        quantity: 0.1,
        grossEur: 10,
        feeEur: 0.04,
        reason: "Prueba distribuida",
        pnlEur,
      }],
    })) as ResearchLabState["strategies"],
  } as ResearchLabState;
}

describe("global PAPER treasury loss brake", () => {
  it("detects three consecutive losses distributed across strategies", () => {
    expect(globalPaperLosingStreak(stateWithDistributedCloses([-0.1, -0.2, -0.3]))).toBe(3);
  });

  it("resets the global streak at the latest non-loss", () => {
    expect(globalPaperLosingStreak(stateWithDistributedCloses([-0.1, 0.2, -0.3]))).toBe(1);
  });

  it("keeps LIVE outside the gate", async () => {
    const source = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../src/paper-entry-treasury-gate.ts", import.meta.url), "utf8"));
    expect(source).toContain("GLOBAL_PAPER_LOSS_STREAK_LIMIT = 3");
    expect(source).toContain("freno global de Tesorería");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
  });
});
