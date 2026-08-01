import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("frozen forward isolation", () => {
  it("runs PAPER and committee impact before advancing the forward observer", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const baseCall = source.indexOf("const response = await super.fetch(request)");
    const forwardCall = source.indexOf("return this.enrichForward(response, true)");

    expect(baseCall).toBeGreaterThan(-1);
    expect(forwardCall).toBeGreaterThan(baseCall);
  });

  it("distinguishes missing state, malformed state and storage failure", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");

    expect(source).toContain("if (raw === undefined) return { state: null, error: null }");
    expect(source).toContain("FROZEN_FORWARD_STATE_INVALID");
    expect(source).toContain("FROZEN_FORWARD_STORAGE_READ_FAILED");
    expect(source).toContain("startsOnNextValidCycle");
  });

  it("fails open for PAPER and cannot revert a completed reset", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");

    expect(source).toContain("failOpenForPaper: true");
    expect(source).toContain("El reset base ya finalizó; el expediente forward no puede revertirlo");
    expect(source).toContain("changesTradingDecision: false");
    expect(source).toContain("liveTrading: false");
  });

  it("does not contain any route or order-submission capability", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const experiment = readFileSync(join(ROOT, "src/frozen-forward-experiment.ts"), "utf8");
    const combined = source + experiment;

    expect(combined).not.toContain("submitOrder");
    expect(combined).not.toContain("LIVE_TRADING_ENABLED");
    expect(combined).not.toContain("/api/pilot/submit");
    expect(combined).not.toContain("createOrder");
  });
});
