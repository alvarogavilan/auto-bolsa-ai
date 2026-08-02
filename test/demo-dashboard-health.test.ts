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

  it("summarizes market freshness, lab cycles, engine success/error split and strategy status", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Mercado Kraken");
    expect(html).toContain("Ciclos del laboratorio");
    expect(html).toContain("Motor principal");
    expect(html).toContain("Estrategias");
    expect(html).toContain("markets.available!==false");
    expect(html).toContain("readiness.successfulTickAttempts");
    expect(html).toContain("readiness.errorsObserved");
    // Regression: "Ciclos del laboratorio" must read the lab's own cycle
    // count (lab.cycles), never fall back to the single-pair engine's
    // successfulTickAttempts — that conflated two unrelated systems under
    // one ambiguous label.
    expect(html).toContain("n(lab.cycles)+' ciclos'");
  });

  it("surfaces the most recent engine error with strategy and timestamp, distinguishing active from historical", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("function lastEngineError");
    expect(html).toContain("Último error registrado");
    expect(html).toContain("consecutiveErrors");
    expect(html).toContain("activo (");
    expect(html).toContain("histórico, ya recuperado");
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
