import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichReadinessWithFireDrill } from "../src/pilot-fire-drill-readiness";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("production fire-drill gate", () => {
  it("deploys the adapter while preserving the original Worker as the core", () => {
    const wrangler = read("wrangler.jsonc");
    const adapter = read("src/index-fire-drill.ts");
    const core = read("src/index.ts");

    expect(wrangler).toContain('"main": "src/index-fire-drill.ts"');
    expect(adapter).toContain('from "./index"');
    expect(adapter).toContain('url.pathname === "/api/pilot/readiness"');
    expect(adapter).toContain('url.pathname === "/api/pilot/refresh-kraken"');
    expect(adapter).toContain("const base = await coreWorker.fetch(request, env)");
    expect(adapter).toContain("const withFireDrill = await enrichReadinessWithFireDrill(base)");
    expect(adapter).toContain("return enrichReadinessWithAccountCleanliness(");

    expect(core).toContain('url.pathname === "/api/pilot/submit"');
    expect(core).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(core).toContain('url.pathname.startsWith("/api/live")');
    expect(core).toContain("LIVE_TRADING_HARD_DISABLED");
  });

  it("never upgrades a readiness report that was already blocked", async () => {
    const response = await enrichReadinessWithFireDrill(Response.json({
      blockers: ["PAPER pendiente"],
      passedChecks: [],
      infrastructureEligibleForManualReview: false,
      liveTrading: false,
    }));
    const body = await response.json<Record<string, unknown>>();
    const fireDrill = body.fireDrill as Record<string, unknown>;

    expect(fireDrill.passed).toBe(true);
    expect(fireDrill.passedChecks).toBe(6);
    expect(body.infrastructureEligibleForManualReview).toBe(false);
    expect(body.blockers).toEqual(["PAPER pendiente"]);
    expect(body.liveTrading).toBe(false);
  });

  it("keeps authentication failures untouched and does not run a public bypass", async () => {
    const original = new Response("Unauthorized", { status: 401 });
    const response = await enrichReadinessWithFireDrill(original);

    expect(response).toBe(original);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });
});
