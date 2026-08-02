import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

async function html(): Promise<string> {
  return (await demoDashboard()).text();
}

describe("DEMO history and evidence integrity", () => {
  it("reconstructs history directly from retained strategy trades", async () => {
    const source = await html();
    expect(source).toContain("state.strategies[].trades");
    expect(source).toContain("renderHistoryFromRetainedTrades");
    expect(source).toContain("history-fallback-card");
    expect(source).toContain("Recuperación de integridad");
  });

  it("renders an explicit evidence fallback when the ledger is not ready", async () => {
    const source = await html();
    expect(source).toContain("renderPaperEvidenceWithTradeFallback");
    expect(source).toContain("paperEvidenceLedger todavía no está disponible");
    expect(source).toContain("Trades persistidos");
    expect(source).toContain("Aprendizaje solo observacional");
  });

  it("keeps LIVE and autonomous parameter changes blocked", async () => {
    const source = await html();
    expect(source).toContain("LIVE desactivado");
    expect(source).toContain("Órdenes reales bloqueadas");
    expect(source).toContain("nunca cambia estrategia, umbrales, PAPER ni LIVE");
  });
});
