import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO history outcome badges", () => {
  it("shows visible winner, loser and open states in the history", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("GANADORA");
    expect(html).toContain("PERDEDORA");
    expect(html).toContain("ABIERTA");
    expect(html).toContain("#history .history-outcome.winner");
    expect(html).toContain("#history .history-outcome.loser");
    expect(html).toContain("#history .history-outcome.open");
  });

  it("propagates a sell result to its associated buy without inventing outcomes", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("const buyId = historyDetailValue(card, 'Compra asociada')");
    expect(html).toContain("const buyCard = byId.get(buyId)");
    expect(html).toContain("if (buyCard) setHistoryOutcome(buyCard, kind, label, pnlText)");
    expect(html).toContain("if (side.includes('COMPRA')) setHistoryOutcome(card, 'open', 'ABIERTA')");
  });

  it("keeps a single render pipeline and blocks LIVE", async () => {
    const html = await (await demoDashboard()).text();
    expect(html.match(/<script>/g)?.length).toBe(2);
    expect(html).toContain("LIVE desactivado");
    expect(html).toContain("Órdenes reales bloqueadas");
  });
});
