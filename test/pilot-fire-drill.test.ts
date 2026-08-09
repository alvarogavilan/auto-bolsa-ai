import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireDrillPilotDashboard } from "../src/pilot-dashboard-fire-drill";
import { runPilotFireDrill } from "../src/pilot-fire-drill";

const ROOT = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("pilot fire drill", () => {
  it("passes every fail-closed scenario without any Kraken network call", async () => {
    const network = vi.fn(async () => {
      throw new Error("The fire drill must never call fetch");
    });
    globalThis.fetch = network as typeof fetch;

    const report = await runPilotFireDrill(1_800_000_000_000);

    expect(report.schemaVersion).toBe("pilot-fire-drill-v1");
    expect(report.passed).toBe(true);
    expect(report.passedChecks).toBe(6);
    expect(report.totalChecks).toBe(6);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.usesMockTransportOnly).toBe(true);
    expect(report.networkCallsToKraken).toBe(0);
    expect(report.realOrderCreated).toBe(false);
    expect(report.changesProductionState).toBe(false);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.liveTrading).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it("covers the six critical scenarios explicitly", async () => {
    const report = await runPilotFireDrill(1_800_000_000_000);
    expect(report.checks.map((check) => check.id)).toEqual([
      "happy-path-and-double-tap",
      "timeout-after-remote-acceptance",
      "partial-fill-balance-mismatch",
      "expired-certificate",
      "mutated-certified-payload",
      "journal-payload-collision",
    ]);
  });

  it("shows the fire drill in the authenticated iPhone console", async () => {
    const response = await fireDrillPilotDashboard();
    const html = await response.text();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Simulacro integral de seguridad");
    expect(html).toContain("Ejecutar 6 pruebas de seguridad");
    expect(html).toContain("/api/pilot/fire-drill");
    expect(html).toContain("runPilotFireDrillFromApp");
    expect(html).toContain("No usa credenciales");
    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("createOrder(");
    expect(html).not.toContain("AddOrder");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");

    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("keeps the core and fire drill isolated behind the PAPER capital wrapper", () => {
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const adapter = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
    const paperWrapper = readFileSync(join(ROOT, "src/index-paper-capital.ts"), "utf8");
    const fallbackClock = readFileSync(join(ROOT, "src/index-paper-fallback-clock.ts"), "utf8");
    const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");

    expect(core).toContain('url.pathname === "/api/pilot/submit"');
    expect(core).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(core).toContain('url.pathname.startsWith("/api/live")');
    expect(core).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(adapter).toContain('from "./index"');
    expect(adapter).toContain('url.pathname === "/api/pilot/fire-drill"');
    expect(adapter).toContain("if (!isAuthorized(request, env))");
    expect(adapter).toContain("return coreWorker.fetch(request, env)");
    expect(adapter).toContain("return coreWorker.scheduled(controller, env, ctx)");
    expect(paperWrapper).toContain('from "./index-fire-drill"');
    expect(paperWrapper).toContain('INITIAL_CASH_EUR: "100"');
    expect(fallbackClock).toContain('from "./index-paper-capital"');
    expect(fallbackClock).toContain('env.TRADING_MODE === "paper"');
    expect(fallbackClock).toContain('env.LIVE_TRADING_ENABLED !== "true"');
    expect(wrangler).toContain('"main": "src/index-paper-fallback-clock.ts"');
  });
});
