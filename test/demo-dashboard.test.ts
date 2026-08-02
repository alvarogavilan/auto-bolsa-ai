import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

async function dashboardHtml(): Promise<string> {
  return (await demoDashboard()).text();
}

describe("standalone PAPER DEMO dashboard", () => {
  it("renders the standalone mobile dashboard with a strict no-store contract", async () => {
    const response = await demoDashboard();
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();

    expect(html).toContain("DEMO en directo");
    expect(html).toContain("Capital virtual");
    expect(html).toContain("Resumen");
    expect(html).toContain("Posiciones");
    expect(html).toContain("Historial");
    expect(html).toContain("Auditoría");
    expect(html).toContain("Rendimiento");
    expect(html).toContain("Sistema");
    expect(html).not.toContain("JSON.stringify");
  });

  it("uses one PAPER source of truth across every tab", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("fetch('/api/lab'");
    expect(html).toContain("function norm()");
    expect(html).toContain("function renderSummary()");
    expect(html).toContain("function renderPositions()");
    expect(html).toContain("function renderHistory()");
    expect(html).toContain("function renderAudit()");
    expect(html).toContain("function renderPerformance()");
    expect(html).toContain("function renderSystem()");
  });

  it("normalizes the nine independent research balances to one 50 euro reference account", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("const TARGET=50");
    expect(html).toContain("scale=t.initial?TARGET/t.initial:1");
    expect(html).toContain("Cuenta equivalente de 50 €");
    expect(html).toContain("no suma ficticia de nueve carteras");
  });

  it("shows current positions and preserves closed losses in the same account value", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("Posiciones vigentes");
    expect(html).toContain("Estado exacto del mismo capital mostrado en Resumen");
    expect(html).toContain("s.position");
    expect(html).toContain("p.entryPrice");
    expect(html).toContain("p.stopLoss");
    expect(html).toContain("p.takeProfit");
    expect(html).toContain("las pérdidas y comisiones cerradas permanecen contabilizadas");
  });

  it("renders every retained order as an expandable audit record", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("Historial completo");
    expect(html).toContain("<details class=\"item\"");
    expect(html).toContain("Precio unitario");
    expect(html).toContain("Comisión");
    expect(html).toContain("PnL realizado");
    expect(html).toContain("t.reason");
    expect(html).toContain("t.id");
  });

  it("explains why many small losses can produce a limited total drawdown", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("Auditoría de cierres");
    expect(html).toContain("Pérdida por costes");
    expect(html).toContain("Stop loss");
    expect(html).toContain("Tiempo máximo");
    expect(html).toContain("Señal revertida");
    expect(html).toContain("Resultado bruto");
    expect(html).toContain("Costes ida/vuelta");
    expect(html).toContain("Resultado neto");
    expect(html).toContain("el histórico completo permanece visible");
  });

  it("keeps LIVE visibly and structurally disabled", async () => {
    const html = await dashboardHtml();
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
    expect(html).toContain("NO APTO LIVE");

    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('url.pathname.startsWith("/api/live")');
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(index).not.toContain('url.pathname === "/live"');
  });

  it("keeps the human DEMO and technical administration on separate routes", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('url.pathname === "/" || url.pathname === "/demo"');
    expect(index).toContain('url.pathname === "/technical"');
    expect(index).toContain("return demoDashboard()");
    expect(index).toContain("return technicalDashboard()");
  });
});
