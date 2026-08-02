import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PAPER runtime fallback capital", () => {
  it("deploys a wrapper that normalizes missing capital to 100 EUR", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
      main?: string;
      vars?: Record<string, string>;
    };
    const wrapper = readFileSync("src/index-paper-capital.ts", "utf8");

    expect(config.main).toBe("src/index-paper-capital.ts");
    expect(config.vars?.INITIAL_CASH_EUR).toBe("100");
    expect(wrapper).toContain('INITIAL_CASH_EUR: "100"');
    expect(wrapper).toContain("paperRuntimeEnv(env)");
    expect(wrapper).toContain("worker.fetch(request, paperRuntimeEnv(env), ctx)");
    expect(wrapper).toContain("worker.scheduled(controller, paperRuntimeEnv(env), ctx)");
  });
});
