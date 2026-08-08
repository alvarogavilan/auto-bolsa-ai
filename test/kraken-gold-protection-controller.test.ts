import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureKrakenGoldInitialProtection } from "../src/kraken-gold-protection-controller";
import { initializeLiveExecutor } from "../src/live-executor";

const storage = {
  async get<T>(_key: string): Promise<T | undefined> { return undefined; },
  async put<T>(_key: string, _value: T): Promise<void> {},
};

const impossibleNonce = async (): Promise<string> => {
  throw new Error("network path should not be reached in this test");
};

describe("PAXG protection controller", () => {
  it("does not contact Kraken when there is no real inventory", async () => {
    const state = initializeLiveExecutor(30, 1_000);
    const result = await ensureKrakenGoldInitialProtection({
      state,
      configuredPair: "PAXGEUR",
      apiKey: "unused",
      apiSecret: "unused",
      nextNonce: impossibleNonce,
      storage,
      now: 2_000,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("not-required");
  });

  it("fails closed for a partial fill while an entry order is still active", async () => {
    const state = initializeLiveExecutor(30, 1_000);
    state.inventory = {
      pair: "PAXGEUR",
      quantityBase: 0.001,
      averageCostEur: 4_000,
      reservedQuantityBase: 0,
    };
    state.activeClOrdId = "entry-still-open";
    const result = await ensureKrakenGoldInitialProtection({
      state,
      configuredPair: "PAXGEUR",
      apiKey: "unused",
      apiSecret: "unused",
      nextNonce: impossibleNonce,
      storage,
      now: 2_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocker).toContain("aún activa");
  });

  it("refuses to protect non-gold inventory", async () => {
    const state = initializeLiveExecutor(30, 1_000);
    state.inventory = {
      pair: "XBTEUR",
      quantityBase: 0.001,
      averageCostEur: 50_000,
      reservedQuantityBase: 0,
    };
    const result = await ensureKrakenGoldInitialProtection({
      state,
      configuredPair: "PAXGEUR",
      apiKey: "unused",
      apiSecret: "unused",
      nextNonce: impossibleNonce,
      storage,
      now: 2_000,
    });
    expect(result.ok).toBe(false);
  });

  it("persists a write-ahead protection record before the remote stop-loss call", () => {
    const source = readFileSync("src/kraken-gold-protection-controller.ts", "utf8");
    const persistIndex = source.indexOf("await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, prepared)");
    const submitIndex = source.indexOf("await placeKrakenStopLossOrder");
    expect(persistIndex).toBeGreaterThan(0);
    expect(submitIndex).toBeGreaterThan(persistIndex);
    expect(source).toContain("prohibido reenviar hasta reconciliarlo");
  });

  it("makes reconciliation fail closed when protection cannot be confirmed", () => {
    const source = readFileSync("src/live-executor-state-gold.ts", "utf8");
    expect(source).toContain("PAXG_PROTECTION_NOT_CONFIRMED");
    expect(source).toContain("state.emergencyStopActive = true");
    expect(source).toContain("state.emergencyStopRequiresManualLiquidation");
  });
});
