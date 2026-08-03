import { describe, expect, it } from "vitest";
import { derivePaperEconomicPerformance } from "../src/paper-economic-performance";

describe("economic PAPER performance", () => {
  it("separates meaningful wins from cent-level positives without changing net PnL", () => {
    const result = derivePaperEconomicPerformance([
      {
        id: "intraday:XDGEUR",
        symbol: "XDG/EUR",
        trades: [
          { side: "sell", pnlEur: -0.0462, grossEur: 5 },
          { side: "sell", pnlEur: 0.0052, grossEur: 10 },
          { side: "sell", pnlEur: 0.3291, grossEur: 10 },
          { side: "sell", pnlEur: 0.75, grossEur: 10 },
        ],
      },
    ]);

    expect(result.closedTrades).toBe(4);
    expect(result.meaningfulWins).toBe(1);
    expect(result.microWins).toBe(2);
    expect(result.losses).toBe(1);
    expect(result.economicWinRatePct).toBe(50);
    expect(result.netPnlEur).toBeCloseTo(1.0381, 6);
  });

  it("does not treat buys or missing PnL as closed outcomes", () => {
    const result = derivePaperEconomicPerformance([
      {
        id: "swing:ZECEUR",
        symbol: "ZEC/EUR",
        trades: [
          { side: "buy", grossEur: 10 },
          { side: "sell", grossEur: 10 },
        ],
      },
    ]);

    expect(result.closedTrades).toBe(0);
    expect(result.economicWinRatePct).toBeNull();
  });
});
