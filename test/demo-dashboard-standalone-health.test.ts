import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standaloneDemoDashboard } from "../src/demo-dashboard-standalone";

function renderWithLabAndDemo(script: string, lab: unknown, demo: unknown): string {
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
  new Script(
    `${body}\nlab=${JSON.stringify(lab)};demo=${JSON.stringify(demo)};strategies=Array.isArray(lab.strategies)?lab.strategies:[];renderSystem();`,
  ).runInContext(context);
  return elements.get("system")?.innerHTML ?? "";
}

describe("Priority 5: comprehensible system health / error summary", () => {
  it("shows the most recent ACTIVE error with strategy and timestamp, ahead of an older historical one", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      cycles: 316,
      strategies: [
        {
          id: "fast:ETHEUR", symbol: "ETH/EUR", lane: "fast", status: "active",
          lastError: "Kraken OHLC HTTP 502", lastAttemptAt: 1_000, consecutiveErrors: 0,
          errors: 3, cycles: 100, initialCashEur: 50, equityEur: 50,
        },
        {
          id: "fast:XBTEUR", symbol: "XBT/EUR", lane: "fast", status: "error",
          lastError: "Kraken OHLC HTTP 429", lastAttemptAt: 5_000, consecutiveErrors: 4,
          errors: 62, cycles: 100, initialCashEur: 50, equityEur: 50,
        },
      ],
    };
    const demo = { readiness: { successfulTickAttempts: 254, errorsObserved: 62 } };

    const output = renderWithLabAndDemo(script, lab, demo);
    const banner = output.slice(output.indexOf("Último error registrado"), output.indexOf("Último error registrado") + 200);
    expect(banner).toContain("Kraken OHLC HTTP 429");
    expect(banner).toContain("XBT/EUR");
    expect(banner).toContain("activo (4 consecutivos)");
    expect(banner).not.toContain("Kraken OHLC HTTP 502");
    expect(output).toContain("316 ciclos");
    expect(output).toContain("254 correctos");
    expect(output).toContain("62 con error");
    expect(output).toContain("1 con error");
  });

  it("falls back to the most recent historical error when no strategy currently has an active one", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      cycles: 10,
      strategies: [
        {
          id: "swing:XBTEUR", symbol: "XBT/EUR", lane: "swing", status: "active",
          lastError: "Kraken OHLC HTTP 502", lastAttemptAt: 2_000, consecutiveErrors: 0,
          errors: 1, cycles: 10, initialCashEur: 50, equityEur: 50,
        },
      ],
    };
    const demo = { readiness: { successfulTickAttempts: 9, errorsObserved: 1 } };

    const output = renderWithLabAndDemo(script, lab, demo);
    expect(output).toContain("Último error registrado");
    expect(output).toContain("histórico, ya recuperado");
    expect(output).toContain("0 con error");
  });

  it("shows no error banner and reports 0 errored strategies when nothing has ever failed", async () => {
    const html = await (await standaloneDemoDashboard()).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

    const lab = {
      cycles: 5,
      strategies: [
        { id: "fast:XBTEUR", symbol: "XBT/EUR", lane: "fast", status: "active", lastError: null, lastAttemptAt: 500, consecutiveErrors: 0, errors: 0, cycles: 5, initialCashEur: 50, equityEur: 50 },
      ],
    };
    const demo = { readiness: { successfulTickAttempts: 5, errorsObserved: 0 } };

    const output = renderWithLabAndDemo(script, lab, demo);
    expect(output).not.toContain("Último error registrado");
    expect(output).toContain("0 con error");
  });
});
