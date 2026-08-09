import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kraken gold production pair", () => {
  it("keeps the deployed pilot on PAXG/EUR while LIVE remains explicitly unarmed", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    const fallbackClock = readFileSync("src/index-paper-fallback-clock.ts", "utf8");

    expect(config.main).toBe("src/index-paper-fallback-clock.ts");
    expect(fallbackClock).toContain('from "./index-paper-capital"');
    expect(config.vars?.PAIR).toBe("PAXGEUR");
    expect(config.vars?.TRADING_MODE).toBe("paper");
    expect(config.vars?.LIVE_TRADING_ENABLED).not.toBe("true");
  });
});
