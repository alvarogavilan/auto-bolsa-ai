import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("scheduled handler: main engine runs before the research lab", () => {
  it("awaits the single-pair engine tick before starting the research lab's Kraken calls", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const scheduled = index.slice(index.indexOf("async scheduled"));

    expect(scheduled).not.toContain("Promise.all([");
    const tickIndex = scheduled.indexOf('singleton(env).fetch("https://bot/tick"');
    const labIndex = scheduled.indexOf("runResearchLab(env)");
    expect(tickIndex).toBeGreaterThan(-1);
    expect(labIndex).toBeGreaterThan(-1);
    expect(tickIndex).toBeLessThan(labIndex);
    expect(scheduled).toContain(".then(() => runResearchLab(env)");
  });

  it("keeps the research lab fail-open: its own failure never blocks or affects the main engine", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const scheduled = index.slice(index.indexOf("async scheduled"));

    expect(scheduled).toContain("runResearchLab(env).catch(() => undefined)");
  });
});
