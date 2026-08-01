import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const indexSource = () => readFileSync(join(ROOT, "src/index.ts"), "utf8");
const wranglerSource = () => readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
const typesSource = () => readFileSync(join(ROOT, "src/types.ts"), "utf8");
const runtimeSource = () => readFileSync(join(ROOT, "src/pilot-runtime.ts"), "utf8");

describe("pilot runtime remains fail-closed", () => {
  it("binds LiveExecutorState with an explicit new Durable Object migration", () => {
    const wrangler = wranglerSource();
    expect(wrangler).toContain('"name": "LIVE_EXECUTOR"');
    expect(wrangler).toContain('"class_name": "LiveExecutorState"');
    expect(wrangler).toContain('"tag": "v3"');
    expect(wrangler).toContain('"new_sqlite_classes": ["LiveExecutorState"]');

    const types = typesSource();
    expect(types).toContain("LIVE_EXECUTOR: DurableObjectNamespace");
    expect(types).toContain('LIVE_EXECUTOR_SINGLETON_NAME = "auto-bolsa-ai-live-executor"');
  });

  it("exports the Durable Object but does not invoke it from the cron", () => {
    const index = indexSource();
    expect(index).toContain("export { BotState, ResearchLabState, LiveExecutorState }");
    const scheduled = index.slice(index.indexOf("async scheduled"));
    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
  });

  it("hard-blocks the pilot submission route before forwarding actions", () => {
    const index = indexSource();
    const submitBlock = index.indexOf('url.pathname === "/api/pilot/submit"');
    const actionMap = index.indexOf("const pilotActions");
    expect(submitBlock).toBeGreaterThan(-1);
    expect(actionMap).toBeGreaterThan(submitBlock);
    expect(index).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(index).toContain("submissionEndpointAvailable: false");

    const actionMapSource = index.slice(actionMap, index.indexOf("const target", actionMap));
    expect(actionMapSource).not.toContain('"/api/pilot/submit"');
    expect(actionMapSource).toContain('"/api/pilot/preflight": "/preflight"');
    expect(actionMapSource).toContain('"/api/pilot/reconcile": "/reconcile"');
  });

  it("keeps all legacy /api/live routes hard-disabled", () => {
    const index = indexSource();
    expect(index).toContain('url.pathname.startsWith("/api/live")');
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
  });

  it("requires ADMIN_TOKEN for every pilot route", () => {
    const index = indexSource();
    const pilotSection = index.slice(
      index.indexOf('url.pathname.startsWith("/api/pilot")'),
      index.indexOf('url.pathname === "/api/lab/run"'),
    );
    expect(pilotSection).toContain("if (!isAuthorized(request, env))");
    expect(pilotSection).toContain("status: 401");
  });

  it("exposes only sanitized Kraken safety fields", () => {
    const runtime = runtimeSource();
    expect(runtime).toContain("safePermissions");
    expect(runtime).toContain("withdrawalPermission");
    expect(runtime).toContain("depositPermission");
    expect(runtime).toContain("earnPermission");
    expect(runtime).not.toContain("apiKeyName");
    expect(runtime).not.toContain("apiSecret");
    expect(runtime).not.toContain("fingerprintKrakenCredentials");
  });

  it("keeps submission unarmed in the readiness report", () => {
    const runtime = runtimeSource();
    expect(runtime).toContain("submissionArmed: false");
    expect(runtime).toContain("submissionEndpointAvailable: false");
    expect(runtime).toContain("maximumOrderNotionalEur: 5");
    expect(runtime).toContain("liveTrading: false");
  });
});
