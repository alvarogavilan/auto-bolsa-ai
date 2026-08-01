import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("system health summary in the DEMO dashboard", () => {
  it("renders a single at-a-glance health verdict above the rest of the panel", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Salud del sistema");
    expect(html).toContain("healthVerdict");
    expect(html).toContain("healthGrid");
    expect(html).toContain("function renderSystemHealth");
  });

  it("summarizes market freshness, lab cycle freshness, engine error rate and strategy status", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Mercado Kraken");
    expect(html).toContain("Ciclo del laboratorio");
    expect(html).toContain("Motor principal (errores)");
    expect(html).toContain("Estrategias");
    expect(html).toContain("markets.available!==false");
    expect(html).toContain("readiness.successfulTickAttempts");
    expect(html).toContain("readiness.errorsObserved");
  });

  it("only reads already-served data, no new endpoints or risk thresholds", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
    expect(html).not.toContain("maxDrawdownPct>");
    expect(html).not.toContain("fetch('/api/health'");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
  });
});
