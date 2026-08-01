import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("human DEMO dashboard", () => {
  it("renders a human-readable mobile dashboard instead of raw JSON", async () => {
    const response = await demoDashboard();
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();

    expect(html).toContain("DEMO en directo");
    expect(html).toContain("Capital virtual");
    expect(html).toContain("Historial de operaciones");
    expect(html).toContain("Compras y ventas simuladas");
    expect(html).toContain("Estrategias activas");
    expect(html).toContain("Expediente PAPER");
  });

  it("shows position, PnL, fees and trade reasons from the public lab response", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("strategy.positionOpen");
    expect(html).toContain("p.entryPrice");
    expect(html).toContain("strategy.currentReferencePrice");
    expect(html).toContain("t.pnlEur");
    expect(html).toContain("t.feeEur");
    expect(html).toContain("t.reason");
    expect(html).toContain("fetch('/api/lab'");
    expect(html).toContain("fetch('/api/readiness'");
  });

  it("makes the complete Kraken EUR market universe visible", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("Universo de mercados");
    expect(html).toContain("Todo el mercado EUR de Kraken");
    expect(html).toContain("marketsDiscovered");
    expect(html).toContain("marketsOnline");
    expect(html).toContain("marketsCompatible");
    expect(html).toContain("candidate.fastEligible");
    expect(html).toContain("candidate.intradayEligible");
    expect(html).toContain("candidate.swingEligible");
    expect(html).toContain("fetch('/api/markets'");
  });

  it("translates Kraken tickers into human market names", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("XBT:'Bitcoin'");
    expect(html).toContain("ETH:'Ethereum'");
    expect(html).toContain("SOL:'Solana'");
    expect(html).toContain("function humanMarket");
    expect(html).toContain("XBT es Bitcoin");
  });

  it("shows activity even when no new trade is executed", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("Actividad en tiempo real");
    expect(html).toContain("Qué está haciendo el sistema");
    expect(html).toContain("renderSystemActivity");
    expect(html).toContain("Sin ciclo reciente");
    expect(html).toContain("lastDecision");
    expect(html).toContain("lastSuccessfulAt");
  });

  it("shows the shadow committee and demanding benchmark suite", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("Comité interno · shadow");
    expect(html).toContain("Decisión auditada por seis funciones");
    expect(html).toContain("renderCommittee");
    expect(html).toContain("Comparación exigente");
    expect(html).toContain("Mejor alternativa pasiva");
    expect(html).toContain("renderBenchmarkSuite");
    expect(html).toContain("changesTradingDecision").toBe(false);
  });

  it("keeps technical JSON and admin controls on a separate route", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('url.pathname === "/" || url.pathname === "/demo"');
    expect(index).toContain('url.pathname === "/technical"');
    expect(index).toContain("return demoDashboard()");
    expect(index).toContain("return technicalDashboard()");
  });

  it("does not add or expose any LIVE route", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('url.pathname.startsWith("/api/live")');
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(index).not.toContain('url.pathname === "/live"');
  });
});
