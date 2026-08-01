import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("persistent PAPER evidence in the DEMO app", () => {
  it("renders the evidence archive and per-strategy retention", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Archivo de evidencia PAPER");
    expect(html).toContain("Historial persistente");
    expect(html).toContain("Movimientos retenidos");
    expect(html).toContain("Máximo por estrategia");
    expect(html).toContain("renderPaperEvidence");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
    expect(match?.[1]).not.toMatch(/^\+/m);
  });

  it("states that evidence retention has no trading authority", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("No modifica ninguna decisión");
    expect(html).toContain("Influye en trading");
    expect(html).not.toContain("Operar desde el archivo");
    expect(html).not.toContain("Autorizar LIVE con evidencia");
  });

  it("uses independent fail-open storage and feeds temporal and stress reports", () => {
    const state = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(state).toContain('const PAPER_EVIDENCE_KEY = "paper-trade-evidence-v1"');
    expect(state).toContain("hydrateStrategiesWithEvidence");
    expect(state).toContain("buildPaperEvidenceLedgerReport");
    expect(state).toContain("PAPER_EVIDENCE_PERSIST_FAILED");
    expect(state).toContain("failOpenForPaper: true");
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(index).toContain('url.pathname.startsWith("/api/live")');
  });

  it("deletes auxiliary evidence on PAPER reset without changing the base reset", () => {
    const state = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");

    expect(state).toContain("Promise.allSettled");
    expect(state).toContain("this.auxiliaryStorage.delete(PAPER_EVIDENCE_KEY)");
    expect(state).toContain("return response");
  });
});
