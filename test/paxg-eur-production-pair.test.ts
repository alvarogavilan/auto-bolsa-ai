import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kraken gold production pair", () => {
  it("keeps the deployed pilot on PAXG/EUR while order submission remains explicitly unarmed", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    const fallbackClock = readFileSync("src/index-paper-fallback-clock.ts", "utf8");
    const telegramWrapper = readFileSync("src/index-telegram-readiness.ts", "utf8");

    expect(config.main).toBe("src/index-telegram-readiness.ts");
    expect(telegramWrapper).toContain('from "./index-paper-fallback-clock"');
    expect(fallbackClock).toContain('from "./index-paper-capital"');
    expect(config.vars?.PAIR).toBe("PAXGEUR");
    expect(config.vars?.TRADING_MODE).toBe("live");
    expect(config.vars?.LIVE_TRADING_ENABLED).not.toBe("true");
  });
});
