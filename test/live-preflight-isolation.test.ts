import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("validate-only preflight isolation in the persistent pilot", () => {
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

  it("deploys validate-only preparation without exposing any submission path", () => {
    const index = read("src/index.ts");
    const wrangler = read("wrangler.jsonc");

    expect(index).toMatch(/from\s*["']\.\/live-executor-state["']/);
    expect(index).toMatch(/export\s*\{[^}]*LiveExecutorState/s);
    expect(index).toContain('"/api/pilot/preflight": "/preflight"');
    expect(index).toContain('url.pathname === "/api/pilot/submit"');
    expect(index).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(index).toMatch(/url\.pathname\.startsWith\(["']\/api\/live["']\)/);
    expect(index).toMatch(/LIVE_TRADING_HARD_DISABLED/);

    const actionMapStart = index.indexOf("const pilotActions");
    const actionMapEnd = index.indexOf("const target", actionMapStart);
    expect(index.slice(actionMapStart, actionMapEnd)).not.toContain('"/api/pilot/submit"');

    expect(wrangler).toMatch(/LIVE_EXECUTOR/);
    expect(wrangler).toMatch(/LiveExecutorState/);
    expect(wrangler).not.toMatch(/LIVE_TRADING_ENABLED/);
    expect(wrangler).toMatch(/["']TRADING_MODE["']\s*:\s*["']paper["']/);

    const scheduled = index.slice(index.indexOf("async scheduled"));
    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
  });
});
