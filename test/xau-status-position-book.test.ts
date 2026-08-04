import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/bot-state.ts", import.meta.url), "utf8");

describe("XAU PAPER production status", () => {
  it("exposes the persisted position book together with the cycle ledger", () => {
    expect(source).toContain("XAU_PAPER_POSITION_KEY");
    expect(source).toContain("parseXauPaperPositionBook");
    expect(source).toContain("private async xauPositionBook()");
    expect(source).toContain("const [ledger, positionBook] = await Promise.all");
    expect(source).toContain("positionBook,");
  });

  it("keeps PAPER and real-order safety flags disabled", () => {
    expect(source).toContain('mode: "paper"');
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrderSubmission: false");
  });
});
