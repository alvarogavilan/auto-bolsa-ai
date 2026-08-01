import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("persistent PAPER evidence in the DEMO app", () => {
  it("renders the evidence archive while preserving the frozen forward experiment", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Archivo de evidencia PAPER");
    expect(html).toContain("Historial persistente");
    expect(html).toContain("Movimientos retenidos");
    expect(html).toContain("Máximo por estrategia");
    expect(html).toContain("renderPaperEvidence");
    expect(html).toContain("Experimento forward congelado");
    expect(html).toContain("renderFrozenForward");
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
    const impact = readFileSync(join(ROOT, "src/research-lab-state-impact.ts"), "utf8");
    const forward = readFileSync(join(ROOT, "src/research-lab-state.ts"), "utf8");
    const indexCore = readFileSync(join(ROOT, "src/index-core.ts"), "utf8");

    expect(impact).toContain('const PAPER_EVIDENCE_KEY = "paper-trade-evidence-v1"');
    expect(impact).toContain("hydrateStrategiesWithEvidence");
    expect(impact).toContain("buildPaperEvidenceLedgerReport");
    expect(impact).toContain("PAPER_EVIDENCE_PERSIST_FAILED");
    expect(impact).toContain("failOpenForPaper: true");
    expect(forward).toContain('from "./research-lab-state-impact"');
    expect(indexCore).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(indexCore).toContain('url.pathname.startsWith("/api/live")');
  });

  it("deletes both impact and evidence on PAPER reset without changing the base reset", () => {
    const impact = readFileSync(join(ROOT, "src/research-lab-state-impact.ts"), "utf8");

    expect(impact).toContain("Promise.allSettled");
    expect(impact).toContain("this.auxiliaryStorage.delete(COMMITTEE_IMPACT_KEY)");
    expect(impact).toContain("this.auxiliaryStorage.delete(PAPER_EVIDENCE_KEY)");
    expect(impact).toContain("return response");
  });
});
