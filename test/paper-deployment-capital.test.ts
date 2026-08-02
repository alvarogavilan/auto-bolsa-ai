import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployed PAPER capital", () => {
  it("keeps the Cloudflare runtime on the single 100 EUR treasury", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
      vars?: Record<string, string>;
    };

    expect(config.vars?.TRADING_MODE).toBe("paper");
    expect(config.vars?.INITIAL_CASH_EUR).toBe("100");
  });
});
