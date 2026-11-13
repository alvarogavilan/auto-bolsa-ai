import { describe, expect, it } from "vitest";
import type { KrakenTicker } from "../src/kraken-markets";
import { buildOrderNow } from "../src/order-now";
import { planSignalAlerts } from "../src/signal-alerts";
import type { SignalHolding } from "../src/signal-alerts-store";
import { homeOrderScreen } from "../src/home-order-screen";

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

function ticker(bid: number, ask: number): KrakenTicker {
  return { ask, bid, last: bid, volume24h: 1, vwap24h: bid, trades24h: 1, low24h: bid, high24h: ask, open24h: bid * 0.99 };
}

const TICKERS = { PAXGEUR: ticker(3498, 3500), XXBTZEUR: ticker(80_000, 80_010), XETHZEUR: ticker(3000, 3001) };
const OPEN = { id: "xau-1-buy", side: "buy", openedAt: NOW - 60_000, entryPrice: 4000, budgetEur: 20, initialStopPrice: 3960, targetPrice: 4100 };

function xauStatus(open: Record<string, unknown> | null, closed: Record<string, unknown>[] = [], decisionAgeMs = 30_000): unknown {
  return {
    metrics: { decisionCycles: 900, approved: 40 },
    cycles: [
      { observedAt: NOW - 3_000, outcome: "observed", instruction: { cycleKind: "monitoring" } },
      {
        observedAt: NOW - decisionAgeMs,
        outcome: "blocked",
        instruction: {
          cycleKind: "decision",
          cabinetDecision: { bias: "long", consensusPct: 64, votes: [{ expert: "Especialista DXY", bias: "long", confidence: 82, reason: "Relación con el dólar." }], vetoes: ["Consenso XAU insuficiente: 64.00 %."] },
        },
      },
    ],
    positionBook: {
      open,
      closed,
      metrics: { closed: 12, winners: 8, realizedPnlEur: 5 },
      treasury: { initialCapitalEur: 100, realizedPnlEur: 5, equityEur: 105, equityCurve: [{ equityEur: 100 }, { equityEur: 105 }] },
    },
  };
}

function holding(overrides: Partial<SignalHolding> = {}): SignalHolding {
  return { holdingKey: "gold", alertId: "ORO-ABC123", buyKey: "gold:buy:xau-1-buy", market: "gold", asset: "ORO (PAXG)", pair: "PAXGEUR", displayPair: "PAXG/EUR", sourceId: "xau-1-buy", openedAt: NOW - 60_000, amountEur: 20, entryPriceEur: 3507, quantityBase: 20 / 3507, ...overrides };
}

function build(status: unknown, holdings: Record<string, SignalHolding>, tickers: Record<string, KrakenTicker> = TICKERS, tickersAvailable = true) {
  const plan = planSignalAlerts({ xauStatus: status, lab: null, holdings, now: NOW });
  return buildOrderNow({ now: NOW, xauStatus: status, holdings, plan, tickers, tickersAvailable });
}

describe("order now", () => {
  it("shows WAIT with the team's reason when nothing is open", () => {
    const order = build(xauStatus(null), {});
    expect(order.primary.action).toBe("wait");
    expect(order.primary.reason).toContain("Consenso XAU insuficiente");
    expect(order.dataFresh).toBe(true);
    expect(order.team?.votes[0]?.expert).toBe("Especialista DXY");
    expect(order.market.map((row) => row.label)).toEqual(["Oro · PAXG/EUR", "Bitcoin · BTC/EUR", "Ethereum · ETH/EUR"]);
  });

  it("shows BUY with a live limit price and expiry for a fresh opening", () => {
    const order = build(xauStatus(OPEN), {});
    expect(order.primary.action).toBe("buy");
    expect(order.primary.priceEur).toBe(3507);
    expect(order.primary.expiresAt).toBe(OPEN.openedAt + 10 * 60_000);
    expect(order.primary.steps.join(" ")).toContain("Precio límite: 3.507,00 €");
  });

  it("keeps the BUY visible after Telegram delivered it, while still valid", () => {
    const order = build(xauStatus(OPEN), { gold: holding() });
    expect(order.primary.action).toBe("buy");
    expect(order.primary.priceEur).toBe(3507);
  });

  it("turns BUY into HOLD when the price escaped or the window expired", () => {
    const escaped = build(xauStatus(OPEN), { gold: holding() }, { ...TICKERS, PAXGEUR: ticker(3528, 3530) });
    expect(escaped.primary.action).toBe("hold");
    const expired = build(xauStatus({ ...OPEN, openedAt: NOW - 11 * 60_000 }), { gold: holding({ openedAt: NOW - 11 * 60_000 }) });
    expect(expired.primary.action).toBe("hold");
    expect(expired.primary.resultPct).toBeCloseTo(((3498 - 3507) / 3507) * 100);
  });

  it("puts SELL first and never hides it", () => {
    const order = build(xauStatus(null, [{ ...OPEN, exitPrice: 3960 }], 30 * 60_000), { gold: holding() });
    expect(order.dataFresh).toBe(false);
    expect(order.primary.action).toBe("sell");
    expect(order.primary.steps.join(" ")).toContain("«Mercado»");
  });

  it("refuses to show a BUY when the engine or the price feed is stale", () => {
    const staleEngine = build(xauStatus(OPEN, [], 10 * 60_000), {});
    expect(staleEngine.primary.action).toBe("wait");
    expect(staleEngine.primary.headline).toContain("NO OPERES");
    const noPrice = build(xauStatus(OPEN), {}, {}, false);
    expect(noPrice.primary.action).toBe("wait");
    expect(noPrice.staleReason).toContain("Kraken");
  });
});

describe("home screen", () => {
  it("serves the order screen that polls the live order", async () => {
    const response = homeOrderScreen();
    const html = await response.text();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("/api/order-now");
    expect(html).toContain("NO EJECUTES");
    expect(html).not.toContain("innerHTML");
  });
});
