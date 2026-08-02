import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("prospective PAPER cohort", () => {
  it("uses an immutable post-filter cutoff and strict readiness criteria", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("PROSPECTIVE_COHORT_STARTED_AT");
    expect(html).toContain("2026-08-02T18:35:30Z");
    expect(html).toContain("2af2e0bb15d911f6cedcd91862ef77c8279ab2ed");
    expect(html).toContain("PROSPECTIVE_MIN_CLOSED_TRADES = 30");
    expect(html).toContain("PROSPECTIVE_MIN_PROFIT_FACTOR = 1.2");
    expect(html).toContain("Validación prospectiva inmutable");
    expect(html).toContain("No incluye operaciones anteriores ni histórico legado");
    expect(html).toContain("PnL neto positivo, expectativa positiva y profit factor ≥ 1,20");
  });

  it("keeps history intact and LIVE blocked", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("El historial no se resetea ni se modifica");
    expect(html).toContain("LIVE continúa bloqueado");
    expect(html).not.toContain("LIVE_TRADING_ENABLED=true");
  });
});
