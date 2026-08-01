import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("pilot fire drill route isolation", () => {
  it("keeps the endpoint authenticated and outside cron", () => {
    const wrapper = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const core = readFileSync(join(ROOT, "src/index-core.ts"), "utf8");

    expect(wrapper).toContain('url.pathname === "/api/pilot/fire-drill"');
    expect(wrapper).toContain("if (!isAuthorized(request, env))");
    expect(wrapper).toContain("runPilotFireDrill()");
    expect(wrapper).not.toContain("KrakenLiveOrderTransport");
    expect(wrapper).not.toContain("AddOrder");
    expect(wrapper).not.toContain("createOrder(");
    expect(core).toContain("async scheduled(");
    expect(core).not.toContain("pilot-fire-drill");
  });
});
