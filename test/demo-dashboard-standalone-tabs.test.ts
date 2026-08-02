import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standaloneDemoDashboard } from "../src/demo-dashboard-standalone";

describe("DEMO standalone dashboard: every tab binds to its real DOM panel", () => {
  it("declares an explicit getElementById binding for every tab, including the ones that collide with native window globals", async () => {
    const html = await (await standaloneDemoDashboard()).text();

    expect(html).toContain("document.getElementById('summary')");
    expect(html).toContain("document.getElementById('positions')");
    expect(html).toContain("document.getElementById('history')");
    expect(html).toContain("document.getElementById('audit')");
    expect(html).toContain("document.getElementById('performance')");
    expect(html).toContain("document.getElementById('evidence')");
    expect(html).toContain("document.getElementById('validation')");
    expect(html).toContain("document.getElementById('system')");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
  });

  it("regression: 'history' and 'performance' panels must resolve to their <section>, not to window.history/window.performance", async () => {
    // This is the exact browser mechanism behind the bug: `history` and
    // `performance` are non-overridable attributes of the Window interface,
    // so an unqualified `history.innerHTML = ...` or `performance.innerHTML
    // = ...` silently mutates the native History/Performance API object
    // instead of the DOM element, leaving the "Historial"/"Rendimiento" tabs
    // permanently blank. node:vm's context object plays the same role as
    // `window`: unqualified identifiers fall back to it unless a script-level
    // const/let shadows them, so this reproduces the real failure mode
    // without needing a browser.
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const bindingLine = script.slice(0, script.indexOf("function renderSummary"));

    const nativeHistorySentinel = { pushState: () => undefined, __native: "history" };
    const nativePerformanceSentinel = { now: () => 0, __native: "performance" };
    const elements = new Map<string, { innerHTML: string }>();
    const context = createContext({
      document: {
        getElementById: (id: string) => {
          if (!elements.has(id)) elements.set(id, { innerHTML: "" });
          return elements.get(id);
        },
      },
      history: nativeHistorySentinel,
      performance: nativePerformanceSentinel,
    });

    new Script(`${bindingLine}\nglobalThis.__probe = { history, performance, summary, positions };`).runInContext(context);

    const probe = (context as { __probe: Record<string, unknown> }).__probe;
    expect(probe.history).not.toBe(nativeHistorySentinel);
    expect(probe.performance).not.toBe(nativePerformanceSentinel);
    expect(probe.history).toBe(elements.get("history"));
    expect(probe.performance).toBe(elements.get("performance"));
    expect(probe.summary).toBe(elements.get("summary"));
    expect(probe.positions).toBe(elements.get("positions"));
  });

  it("regression: renderHistory and renderPerformance write into the real panel element, not the native window object", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    // Everything up to the tab click-wiring / initial load() call, so we can
    // invoke the render functions ourselves against a controlled fake lab.
    const body = script.slice(0, script.indexOf("document.querySelectorAll('.tab')"));

    const nativeHistorySentinel: Record<string, unknown> = { __native: "history" };
    const nativePerformanceSentinel: Record<string, unknown> = { __native: "performance" };
    const elements = new Map<string, { innerHTML: string }>();
    const context = createContext({
      document: {
        getElementById: (id: string) => {
          if (!elements.has(id)) elements.set(id, { innerHTML: "" });
          return elements.get(id);
        },
      },
      history: nativeHistorySentinel,
      performance: nativePerformanceSentinel,
      Intl,
      Number,
      Array,
      String,
      Math,
      Date,
    });

    new Script(
      `${body}\nstrategies=[{symbol:'XBT/EUR',lane:'fast',initialCashEur:50,cashEur:40,equityEur:40,performance:{netPnlEur:0,grossPnlEur:0,totalFeesEur:0,buys:1,sells:1,closedTrades:1,winningTrades:0,losingTrades:1},trades:[{side:'buy',price:60000,quantity:0.0001,grossEur:6,feeEur:0.02,timestamp:1,reason:'x',id:'t1'},{side:'sell',price:59000,quantity:0.0001,grossEur:5.9,feeEur:0.02,timestamp:2,reason:'y',id:'t2',pnlEur:-0.14}],errors:0,cycles:1,status:'active',consecutiveErrors:0,lastError:null,lastDecision:'hold'}];\nrenderHistory();renderPerformance();\nglobalThis.__probe = { historyHtml: history.innerHTML, performanceHtml: performance.innerHTML, nativeHistoryUntouched: !('innerHTML' in ${JSON.stringify({})} ) };`,
    ).runInContext(context);

    const probe = (context as { __probe: { historyHtml: string; performanceHtml: string } }).__probe;
    expect(probe.historyHtml).toContain("Historial completo");
    expect(probe.historyHtml).toContain("COMPRA");
    expect(probe.performanceHtml).toContain("Rendimiento");
    expect(probe.performanceHtml).toContain("PnL neto");
    expect(nativeHistorySentinel.innerHTML).toBeUndefined();
    expect(nativePerformanceSentinel.innerHTML).toBeUndefined();
  });
});
