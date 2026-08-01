import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("committee shadow isolation", () => {
  it("runs the base laboratory before enriching the response", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const baseCall = source.indexOf("const response = await super.fetch(request)");
    const enrichCall = source.indexOf("return this.enrichLabResponse(response, true)");

    expect(baseCall).toBeGreaterThan(-1);
    expect(enrichCall).toBeGreaterThan(baseCall);
  });

  it("fails open when auxiliary storage cannot be read, persisted or reset", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");

    expect(source).toContain("COMMITTEE_IMPACT_STORAGE_READ_FAILED");
    expect(source).toContain("COMMITTEE_IMPACT_PERSIST_FAILED");
    expect(source).toContain("PAPER_EVIDENCE_STORAGE_READ_FAILED");
    expect(source).toContain("PAPER_EVIDENCE_PERSIST_FAILED");
    expect(source).toContain("failOpenForPaper: true");
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("this.auxiliaryStorage.delete(COMMITTEE_IMPACT_KEY)");
    expect(source).toContain("this.auxiliaryStorage.delete(PAPER_EVIDENCE_KEY)");
    expect(source).toContain("changesTradingDecision: false");
  });

  it("does not add any submission or live route", () => {
    const source = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");

    expect(source).not.toContain("submitOrder");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
    expect(source).not.toContain("/api/pilot/submit");
  });
});
