import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("gold stale validation reset", () => {
  it("only clears an unsent prepared order from a different pair", () => {
    const source = readFileSync("src/live-executor-state-gold.ts", "utf8");
    expect(source).toContain('order.status === "prepared"');
    expect(source).toContain("order.exchangeOrderId === null");
    expect(source).toContain("order.attempts === 0");
    expect(source).toContain("order.filledVolumeBase === 0");
    expect(source).toContain("state.inventory.quantityBase === 0");
    expect(source).toContain("state.inventory.reservedQuantityBase === 0");
    expect(source).toContain("if (pendingJournal) return");
    expect(source).toContain('this.env.PAIR || "PAXGEUR"');
  });

  it("exports the gold-aware Durable Object without enabling LIVE", () => {
    const entry = readFileSync("src/index-fire-drill.ts", "utf8");
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    expect(entry).toContain('GoldLiveExecutorState as LiveExecutorState');
    expect(wrangler).toContain('"PAIR": "PAXGEUR"');
    expect(wrangler).not.toContain("LIVE_TRADING_ENABLED");
  });
});
