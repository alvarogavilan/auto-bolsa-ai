import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("financial visibility in the DEMO dashboard", () => {
  it("renders a capital curve reconstructed from trade history", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Curva de capital");
    expect(html).toContain("Evolución del capital");
    expect(html).toContain("capitalCurveChart");
    expect(html).toContain("function buildEquityCurve");
    expect(html).toContain("function renderCapitalCurve");
  });

  it("shows both fee-inclusive and fee-exclusive PnL plus commissions", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Resultado bruto y neto");
    expect(html).toContain("PnL neto (con comisiones)");
    expect(html).toContain("PnL bruto (sin comisiones)");
    expect(html).toContain("Comisiones totales pagadas");
    expect(html).toContain("function renderPerformanceSummary");
  });

  it("shows open and closed positions across the whole lab", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Posiciones abiertas y cerradas");
    expect(html).toContain("positionsOpenCount");
    expect(html).toContain("positionsClosedCount");
    expect(html).toContain("function renderPositionsOverview");
  });

  it("surfaces the pre-trade execution quality gate as estimated slippage", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Coste de ejecución estimado");
    expect(html).toContain("Coste ida y vuelta estimado");
    expect(html).toContain("function renderExecutionQualityGate");
    expect(html).toContain("immediateRoundTripCostPct");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
  });

  it("only reads already-served lab data, never orders or LIVE routes", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
    expect(html).not.toContain("createOrder");
    expect(html).not.toContain("AddOrder");
  });
});
