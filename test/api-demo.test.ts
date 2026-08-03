import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
const paperWrapper = readFileSync(join(ROOT, "src/index-paper-capital.ts"), "utf8");
const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");

describe("GET /api/demo", () => {
  it("agrega todas las fuentes PAPER de forma fail-soft", () => {
    expect(source).toContain('url.pathname === "/api/demo"');
    for (const path of ["/api/status", "/api/readiness", "/api/lab", "/api/markets", "/api/execution", "/api/decisions"]) {
      expect(source).toContain(`readDemoSource("${path}", env)`);
    }
    expect(source).toContain("Promise.all([");
    expect(source).toContain("partial:");
    expect(source).toContain("sourceHealth:");
  });

  it("es estrictamente PAPER y nunca arma órdenes reales", () => {
    expect(source).toContain('mode: "paper"');
    expect(source).toContain("liveTrading: false");
    expect(source).toContain("realOrdersEnabled: false");
    expect(source).not.toContain("AddOrder");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
  });

  it("mantiene Durable Objects, capital PAPER y el ciclo base cada cinco minutos", () => {
    expect(source).toContain("export { BotState, ResearchLabState, LiveExecutorState }");
    expect(source).toContain("return coreWorker.fetch(request, env)");
    expect(source).toContain("return coreWorker.scheduled(controller, env, ctx)");
    expect(paperWrapper).toContain('from "./index-fire-drill"');
    expect(paperWrapper).toContain('INITIAL_CASH_EUR: "100"');
    expect(paperWrapper).toContain("getUTCMinutes() % 5 === 0");
    expect(wrangler).toContain('"main": "src/index-paper-capital.ts"');
    expect(wrangler).toContain('"TRADING_MODE": "paper"');
    expect(wrangler).toContain('"* * * * *"');
  });

  it("evita caché para que el iPhone reciba estado actual", () => {
    expect(source).toContain('"Cache-Control": "no-store"');
  });
});
