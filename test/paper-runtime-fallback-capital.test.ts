import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PAPER runtime fallback capital", () => {
  it("does not retain a hidden 50 EUR fallback in the Worker runtime", () => {
    const source = readFileSync("src/index.ts", "utf8");
    expect(source).not.toContain('INITIAL_CASH_EUR || "50"');
    expect(source).not.toContain("INITIAL_CASH_EUR || '50'");
  });
});
