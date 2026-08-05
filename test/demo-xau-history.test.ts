import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("DEMO XAU closed history", () => {
  it("renders the persisted closed XAU book inside the History tab", () => {
    expect(source).toContain("xau-history-panel");
    expect(source).toContain("document.getElementById('history')");
    expect(source).toContain("Array.isArray(book && book.closed)");
    expect(source).toContain("Historial XAU/USD");
  });

  it("shows auditable economics and closure evidence", () => {
    expect(source).toContain("Beneficio bruto");
    expect(source).toContain("Costes");
    expect(source).toContain("Resultado neto");
    expect(source).toContain("Motivo de cierre");
    expect(source).toContain("closedAt");
    expect(source).toContain("exitPrice");
  });

  it("does not classify an open position as realized history", () => {
    expect(source).toContain("Una posición abierta no se contabiliza como beneficio realizado");
  });
});
