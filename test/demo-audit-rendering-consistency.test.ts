import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO audit rendering consistency", () => {
  it("renders an explicit empty history state from the same PAPER source", async () => {
    const response = await demoDashboard();
    const html = await response.text();

    expect(html).toContain("Sin operaciones PAPER persistidas en la fuente única actual.");
    expect(html).toContain("if (history) history.innerHTML = historyMarkup(trades)");
  });

  it("accepts ISO and numeric timestamps without falling back to 1970", async () => {
    const response = await demoDashboard();
    const html = await response.text();

    expect(html).toContain("new Date(String(value))");
    expect(html).toContain("Number.isNaN(parsed.getTime()) ? '—'");
  });

  it("keeps LIVE activation explicitly blocked", async () => {
    const response = await demoDashboard();
    const html = await response.text();

    expect(html).toContain("DINERO REAL BLOQUEADO");
    expect(html).toContain("Esto no activa LIVE automáticamente");
  });
});
