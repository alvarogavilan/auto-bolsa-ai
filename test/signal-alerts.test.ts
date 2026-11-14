import { describe, expect, it } from "vitest";
import {
  GOLD_BUY_WINDOW_MS,
  buyAlertText,
  buyExecution,
  planSignalAlerts,
  sellAlertText,
} from "../src/signal-alerts";
import type { LabAlertStrategyView, LabAlertView } from "../src/signal-alerts-lab-view";
import {
  claimSignalAlert,
  commitSignalAlert,
  emptySignalAlertState,
  releaseSignalAlert,
  type SignalHolding,
} from "../src/signal-alerts-store";

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

function xauStatus(options: {
  open?: Record<string, unknown> | null;
  closed?: Record<string, unknown>[];
  closedCount?: number;
  realizedPnlEur?: number;
}): unknown {
  const closedCount = options.closedCount ?? 12;
  const realized = options.realizedPnlEur ?? 4;
  return {
    metrics: { decisionCycles: 900, approved: 40 },
    cycles: [{ observedAt: NOW - 30_000, outcome: "blocked", instruction: { cycleKind: "decision" } }],
    positionBook: {
      open: options.open ?? null,
      closed: options.closed ?? [],
      metrics: { closed: closedCount, winners: Math.round(closedCount * 0.6), realizedPnlEur: realized },
      treasury: {
        initialCapitalEur: 100,
        realizedPnlEur: realized,
        equityEur: 100 + realized,
        equityCurve: [{ equityEur: 100 }, { equityEur: 100 + realized }],
      },
    },
  };
}

function goldOpen(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "xau-1-buy",
    side: "buy",
    openedAt: NOW - 60_000,
    entryPrice: 4000,
    budgetEur: 20,
    initialStopPrice: 3960,
    stopPrice: 3960,
    targetPrice: 4100,
    ...overrides,
  };
}

function goldHolding(): SignalHolding {
  return {
    holdingKey: "gold",
    alertId: "ORO-ABC123",
    buyKey: "gold:buy:xau-1-buy",
    market: "gold",
    asset: "ORO (PAXG)",
    pair: "PAXGEUR",
    displayPair: "PAXG/EUR",
    sourceId: "xau-1-buy",
    openedAt: NOW - 60_000,
    amountEur: 20,
    entryPriceEur: 3500,
    quantityBase: 20 / 3500,
  };
}

function strategy(overrides: Partial<LabAlertStrategyView> = {}): LabAlertStrategyView {
  return {
    id: "intraday:XXBTZEUR",
    lane: "intraday",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "BTC",
    status: "active",
    position: { quantity: 0.0001, entryPrice: 80_000, entryTime: NOW - 120_000, costEur: 10.04, stopLoss: 78_400, takeProfit: 83_200 },
    recentTrades: [{ id: "t-buy-1", side: "buy", timestamp: NOW - 120_000, price: 80_000, quantity: 0.000125, grossEur: 10, feeEur: 0.04, reason: "Cruce EMA alcista" }],
    closedTrades: 40,
    netPnlEur: 6.5,
    winRatePct: 58,
    profitFactor: 1.4,
    maxDrawdownPct: 0.02,
    eligibleForHumanReview: true,
    ...overrides,
  };
}

function lab(strategies: LabAlertStrategyView[]): LabAlertView {
  return { schemaVersion: "lab-alert-view-v1", initialized: true, observedAt: NOW, strategies };
}

describe("gold BUY/SELL alerts", () => {
  it("emits one BUY when a fresh long position opens with enough evidence", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen() }), lab: null, holdings: {}, now: NOW });
    expect(plan.buys).toHaveLength(1);
    expect(plan.buys[0]?.key).toBe("gold:buy:xau-1-buy");
    expect(plan.buys[0]?.amountEur).toBe(20);
    expect(plan.buys[0]?.stopRatio).toBeCloseTo(0.99);
    expect(plan.sells).toHaveLength(0);
  });

  it("never alerts a short signal on spot", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen({ side: "sell" }) }), lab: null, holdings: {}, now: NOW });
    expect(plan.buys).toHaveLength(0);
    expect(plan.sells).toHaveLength(0);
  });

  it("does not send a late BUY after the window expired", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen({ openedAt: NOW - GOLD_BUY_WINDOW_MS - 1 }) }), lab: null, holdings: {}, now: NOW });
    expect(plan.buys).toHaveLength(0);
  });

  it("suppresses BUY when simulated history is insufficient or negative", () => {
    const few = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen(), closedCount: 3 }), lab: null, holdings: {}, now: NOW });
    expect(few.buys).toHaveLength(0);
    expect(few.suppressed[0]?.reason).toContain("historial insuficiente");
    const losing = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen(), realizedPnlEur: -2 }), lab: null, holdings: {}, now: NOW });
    expect(losing.buys).toHaveLength(0);
  });

  it("stays silent while the alerted position is still open", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen() }), lab: null, holdings: { gold: goldHolding() }, now: NOW });
    expect(plan.buys).toHaveLength(0);
    expect(plan.sells).toHaveLength(0);
  });

  it("emits SELL once the alerted position is closed by its stop", () => {
    const plan = planSignalAlerts({
      xauStatus: xauStatus({ open: null, closed: [{ ...goldOpen(), exitPrice: 4040, trailingActive: true }] }),
      lab: null,
      holdings: { gold: goldHolding() },
      now: NOW,
    });
    expect(plan.sells).toHaveLength(1);
    expect(plan.sells[0]?.key).toBe("gold:sell:xau-1-buy");
    expect(plan.sells[0]?.reason).toContain("protege la ganancia");
    expect(plan.sells[0]?.simulatedResultPct).toBeCloseTo(1);
  });

  it("never emits SELL for a position that was not alerted as BUY", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: null, closed: [{ ...goldOpen(), exitPrice: 3950 }] }), lab: null, holdings: {}, now: NOW });
    expect(plan.sells).toHaveLength(0);
  });
});

describe("crypto BUY/SELL alerts", () => {
  it("alerts only evidence-eligible strategies", () => {
    const ok = planSignalAlerts({ xauStatus: null, lab: lab([strategy()]), holdings: {}, now: NOW });
    expect(ok.buys).toHaveLength(1);
    expect(ok.buys[0]?.displayPair).toBe("BTC/EUR");
    const weak = planSignalAlerts({ xauStatus: null, lab: lab([strategy({ eligibleForHumanReview: false })]), holdings: {}, now: NOW });
    expect(weak.buys).toHaveLength(0);
    expect(weak.suppressed).toHaveLength(1);
  });

  it("caps simultaneous crypto positions and avoids duplicates of the same coin", () => {
    const plan = planSignalAlerts({
      xauStatus: null,
      lab: lab([strategy(), strategy({ id: "fast:XXBTZEUR", lane: "fast" }), strategy({ id: "swing:XETHZEUR", base: "ETH", pairKey: "XETHZEUR" })]),
      holdings: {},
      now: NOW,
    });
    expect(plan.buys).toHaveLength(1);
  });

  it("emits SELL when the strategy that was alerted closes its position", () => {
    const holding: SignalHolding = { ...goldHolding(), holdingKey: "crypto:intraday:XXBTZEUR", market: "crypto", asset: "BTC", pair: "XXBTZEUR", displayPair: "BTC/EUR", sourceId: "intraday:XXBTZEUR", openedAt: NOW - 120_000, entryPriceEur: 80_000, alertId: "BTC-1" };
    const closed = strategy({
      position: null,
      recentTrades: [{ id: "t-sell-1", side: "sell", timestamp: NOW, price: 78_400, quantity: 0.000125, grossEur: 9.8, feeEur: 0.04, reason: "Stop loss del carril", pnlEur: -0.2 }],
    });
    const plan = planSignalAlerts({ xauStatus: null, lab: lab([closed]), holdings: { [holding.holdingKey]: holding }, now: NOW });
    expect(plan.sells).toHaveLength(1);
    expect(plan.sells[0]?.reason).toBe("Stop loss del carril.");
    expect(plan.sells[0]?.simulatedResultPct).toBeCloseTo(-2);
  });
});

describe("alert messages", () => {
  it("BUY text is a closed, step-by-step instruction", () => {
    const plan = planSignalAlerts({ xauStatus: xauStatus({ open: goldOpen() }), lab: null, holdings: {}, now: NOW });
    const alert = plan.buys[0]!;
    const execution = buyExecution(alert, 3500);
    expect(execution.limitPriceEur).toBe(3507);
    const text = buyAlertText(alert, execution);
    expect(text.startsWith("🟢 COMPRA AHORA · ORO (PAXG)")).toBe(true);
    expect(text).toContain("«Operar» → «Comprar»");
    expect(text).toContain("PAXG (PAX Gold)");
    expect(text).toContain("debe ser 3.507,00 € o menos");
    expect(text).toContain("importe: 20,00 €");
    expect(text).toContain("NO compres si");
    expect(text).toContain("VENDE AHORA");
    expect(text).toContain("NO ha enviado ninguna orden");
  });

  it("SELL text says sell everything at market", () => {
    const text = sellAlertText({ kind: "sell", key: "gold:sell:x", holdingKey: "gold", holding: goldHolding(), reason: "Stop.", simulatedResultPct: null }, 3465);
    expect(text.startsWith("🔴 VENDE AHORA · ORO (PAXG)")).toBe(true);
    expect(text).toContain("«Operar» → «Vender»");
    expect(text).toContain("recibe en euros");
    expect(text).toContain("TODO lo comprado con la alerta ORO-ABC123");
    expect(text).toContain("-1,00 %");
  });
});

describe("alert deduplication store", () => {
  it("claims a key only once and allows retry after release", () => {
    const state = emptySignalAlertState();
    expect(claimSignalAlert(state, "gold:buy:1", NOW)).toBe(true);
    expect(claimSignalAlert(state, "gold:buy:1", NOW)).toBe(false);
    releaseSignalAlert(state, "gold:buy:1");
    expect(claimSignalAlert(state, "gold:buy:1", NOW)).toBe(true);
  });

  it("opens and closes holdings on commit", () => {
    const state = emptySignalAlertState();
    const log = { at: NOW, key: "k", alertId: "a", kind: "buy" as const, market: "gold" as const, displayPair: "PAXG/EUR", delivered: true, suppressed: false, detail: "" };
    commitSignalAlert(state, { openHolding: goldHolding(), log });
    expect(state.holdings.gold).toBeDefined();
    commitSignalAlert(state, { closeHoldingKey: "gold", log: { ...log, kind: "sell" } });
    expect(state.holdings.gold).toBeUndefined();
    expect(state.log).toHaveLength(2);
  });
});
