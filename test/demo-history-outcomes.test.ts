import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO history outcome badges", () => {
  it("shows economic winners, microprofits, losers and open states", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("GANADORA ECONÓMICA");
    expect(html).toContain("MICROBENEFICIO");
    expect(html).toContain("PERDEDORA");
    expect(html).toContain("ABIERTA");
    expect(html).toContain("MINIMUM_MEANINGFUL_NET_PROFIT_EUR = 0.5");
    expect(html).toContain("#history .history-outcome.winner");
    expect(html).toContain("#history .history-outcome.micro");
    expect(html).toContain("#history .history-outcome.loser");
    expect(html).toContain("#history .history-outcome.open");
  });

  it("does not classify cent-level positive PnL as a winner", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("if (pnl >= MINIMUM_MEANINGFUL_NET_PROFIT_EUR)");
    expect(html).toContain("if (pnl > 0.005) return { kind: 'micro', label: 'MICROBENEFICIO' }");
    expect(html).not.toContain("const kind = pnl > 0 ? 'winner'");
  });

  it("labels the associated buy once and removes duplicate badges", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("ENTRADA DE GANADORA ECONÓMICA");
    expect(html).toContain("ENTRADA DE MICROBENEFICIO");
    expect(html).toContain("ENTRADA DE PERDEDORA");
    expect(html).toContain("const directOutcomeBadges");
    expect(html).toContain("badges.forEach((duplicate) => duplicate.remove())");
    expect(html).toContain("window.__demoHistoryOutcomeInterval");
    expect(html).toContain("setHistoryOutcome(buyCard, outcome.kind, entryLabel, pnlText)");
  });

  it("keeps a single render pipeline and blocks LIVE", async () => {
    const html = await (await demoDashboard()).text();
    expect(html.match(/<script>/g)?.length).toBe(2);
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
