import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standaloneDemoDashboard } from "../src/demo-dashboard-standalone";

function renderWithStrategies(script: string, strategies: unknown[]): string {
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

describe("Priority 7: Historial distinguishes legitimate repeat trades from real duplicates", () => {
  it("shows the associated buy for a sell that closes a real position", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const strategies = [
      {
        id: "fast:XBTEUR",
        symbol: "XBT/EUR",
        lane: "fast",
        trades: [
          { id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 1, grossEur: 100, feeEur: 0.4, reason: "cruce alcista" },
          { id: "sell-1", side: "sell", timestamp: 2_000, price: 110, quantity: 1, grossEur: 110, feeEur: 0.44, reason: "take profit", pnlEur: 9 },
        ],
      },
    ];

    const output = renderWithStrategies(script, strategies);
    expect(output).toContain("Compra asociada");
    expect(output).toContain("buy-1");
    expect(output).not.toContain("Aviso de integridad");
    expect(output).not.toContain("DUPLICADO");
  });

  it("never flags legitimate repeat buys on the same strategy as duplicates when their IDs differ", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const strategies = [
      {
        id: "fast:XBTEUR",
        symbol: "XBT/EUR",
        lane: "fast",
        trades: [
          { id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 1, grossEur: 100, feeEur: 0.4, reason: "cruce alcista" },
          { id: "sell-1", side: "sell", timestamp: 2_000, price: 110, quantity: 1, grossEur: 110, feeEur: 0.44, reason: "take profit", pnlEur: 9 },
          { id: "buy-2", side: "buy", timestamp: 3_000, price: 105, quantity: 1, grossEur: 105, feeEur: 0.42, reason: "cruce alcista" },
        ],
      },
    ];

    const output = renderWithStrategies(script, strategies);
    expect(output).not.toContain("Aviso de integridad");
    expect(output).not.toContain("DUPLICADO");
  });

  it("flags a real duplicate: the same operation ID persisted more than once", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const strategies = [
      {
        id: "fast:XBTEUR",
        symbol: "XBT/EUR",
        lane: "fast",
        trades: [
          { id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 1, grossEur: 100, feeEur: 0.4, reason: "cruce alcista" },
          { id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 1, grossEur: 100, feeEur: 0.4, reason: "cruce alcista" },
        ],
      },
    ];

    const output = renderWithStrategies(script, strategies);
    expect(output).toContain("Aviso de integridad");
    expect(output).toContain("persistencia duplicada real");
    expect(output).toContain("DUPLICADO");
  });

  it("shows an explicit message instead of guessing an association when no matching buy is retained", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const strategies = [
      {
        id: "swing:ETHEUR",
        symbol: "ETH/EUR",
        lane: "swing",
        trades: [
          { id: "sell-orphan", side: "sell", timestamp: 2_000, price: 110, quantity: 1, grossEur: 110, feeEur: 0.44, reason: "stop loss", pnlEur: -3 },
        ],
      },
    ];

    const output = renderWithStrategies(script, strategies);
    expect(output).toContain("Compra asociada");
    expect(output).toContain("Sin pareja retenida");
  });

  it("shows Estrategia and Carril for every order", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const strategies = [
      {
        id: "swing:ETHEUR",
        symbol: "ETH/EUR",
        lane: "swing",
        trades: [
          { id: "buy-1", side: "buy", timestamp: 1_000, price: 100, quantity: 1, grossEur: 100, feeEur: 0.4, reason: "cruce alcista" },
        ],
      },
    ];

    const output = renderWithStrategies(script, strategies);
    expect(output).toContain("Estrategia");
    expect(output).toContain("swing:ETHEUR");
    expect(output).toContain("Carril");
    expect(output).toContain("Swing");
  });
});
