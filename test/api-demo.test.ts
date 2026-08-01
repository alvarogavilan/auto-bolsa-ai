import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "src/index-api-demo.ts"), "utf8");
const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");

describe("GET /api/demo", () => {
  it("agrega todas las fuentes PAPER de forma fail-soft", () => {
    expect(source).toContain('url.pathname === "/api/demo"');
    for (const path of [
      "/api/status",
      "/api/readiness",
      "/api/lab",
      "/api/markets",
      "/api/execution",
      "/api/decisions",
    ]) {
      expect(source).toContain(`readSource("${path}", env)`);
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
    expect(source).not.toContain("/api/pilot/submit");
  });

  it("mantiene Durable Objects, cron y Worker original mediante wrapper", () => {
    expect(source).toContain("export { BotState, ResearchLabState, LiveExecutorState }");
    expect(source).toContain("return worker.fetch(request, env, ctx)");
    expect(source).toContain("return worker.scheduled(controller, env, ctx)");
    expect(wrangler).toContain('"main": "src/index-api-demo.ts"');
    expect(wrangler).toContain('"TRADING_MODE": "paper"');
    expect(wrangler).toContain('"*/5 * * * *"');
  });

  it("evita caché para que el iPhone reciba estado actual", () => {
    expect(source).toContain('"Cache-Control": "no-store"');
  });
});
