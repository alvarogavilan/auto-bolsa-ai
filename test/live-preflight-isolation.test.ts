import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("dormant validate-only preflight isolation", () => {
  it("assembles the internal preflight only for an exact prepared LIVE order", () => {
    const state = read("src/live-executor-state.ts");
    expect(state).toMatch(/url\.pathname\s*===\s*["']\/preflight["']/);
    expect(state).toMatch(/new\s+KrakenValidateOnlyOrderGateway/);
    expect(state).toMatch(/runLiveOrderPreflight\s*\(/);
    expect(state).toMatch(/const order = state\.orders\[body\.clOrdId\]/);
    expect(state).toMatch(/order\.status\s*!==\s*["']prepared["']/);
    expect(state).toMatch(/clOrdIdFactory:\s*\(\)\s*=>\s*order\.clOrdId/);
    expect(state).toMatch(/maxNotionalEur:\s*5/);
    expect(state).toMatch(/createLivePreflightCertificate\(intent, result\)/);
  });

  it("does not expose or instantiate LiveExecutorState in the deployed Worker", () => {
    const index = read("src/index.ts");
    const wrangler = read("wrangler.jsonc");

    expect(index).not.toMatch(/from\s*["']\.\/live-executor-state["']/);
    expect(index).not.toMatch(/export\s*\{[^}]*LiveExecutorState/s);
    expect(index).not.toMatch(/\/api\/kraken\/order-preflight/);
    expect(index).toMatch(/url\.pathname\.startsWith\(["']\/api\/live["']\)/);
    expect(index).toMatch(/LIVE_TRADING_HARD_DISABLED/);

    expect(wrangler).not.toMatch(/LIVE_EXECUTOR/);
    expect(wrangler).not.toMatch(/LiveExecutorState/);
    expect(wrangler).not.toMatch(/LIVE_TRADING_ENABLED/);
    expect(wrangler).toMatch(/["']TRADING_MODE["']\s*:\s*["']paper["']/);
  });
});
