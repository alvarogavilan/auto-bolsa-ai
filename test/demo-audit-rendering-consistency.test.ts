import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

function renderHistoryWithStrategies(script: string, strategies: unknown[]): string {
  const body = script.slice(0, script.indexOf("document.querySelectorAll('.tab')"));
  const elements = new Map<string, { innerHTML: string }>();
  const context = createContext({
    document: {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, { innerHTML: "" });
        return elements.get(id);
      },
    },
    history: {},
    performance: {},
    Intl,
    Number,
    Array,
    String,
    Math,
    Date,
  });
  new Script(`${body}\nstrategies=${JSON.stringify(strategies)};renderHistory();`).runInContext(context);
  return elements.get("history")?.innerHTML ?? "";
}

describe("DEMO audit rendering consistency", () => {
  it("renders an explicit empty history state from the same PAPER source, with a single render pipeline", async () => {
    const html = await (await demoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const output = renderHistoryWithStrategies(script, []);
    expect(output).toContain("0 órdenes conservadas");

    // A second, legacy patch script used to fetch /api/lab again after load
    // and overwrite #history.innerHTML with its own, less complete markup
    // (no Estrategia, Carril, duplicate detection or Compra asociada),
    // silently discarding this render. There must be exactly one script
    // rendering the DEMO now.
    expect(html.match(/<script>/g)?.length).toBe(2);
    expect(html).not.toContain("historyMarkup");
    expect(html).not.toContain("evidenceMarkup");
  });

  it("accepts ISO and numeric timestamps without falling back to 1970", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("new Date(String(v))");
    expect(html).toContain("Number.isNaN(p.getTime())?'—'");
  });

  it("keeps LIVE activation explicitly blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("DINERO REAL BLOQUEADO");
    expect(html).toContain("Esto no activa LIVE automáticamente");
  });
});
