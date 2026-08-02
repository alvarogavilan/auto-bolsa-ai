import { describe, expect, it } from "vitest";
import { DEMO_LIVE_PRICES_SCRIPT } from "../src/demo-live-prices";

describe("DEMO live accounting", () => {
  it("values the account from cash plus live liquidation value only", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const account = cash + liveValue");
    expect(DEMO_LIVE_PRICES_SCRIPT).not.toContain("closedOnlyEquity");
  });

  it("does not recalculate the account from a partial ticker response", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("liveRows.length !== expectedOpenPositions");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("No se recalcula la cuenta con datos parciales");
  });

  it("updates cash and invested capital from the same normalized ledger", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("byLabel('Saldo disponible')");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("byLabel('Capital invertido')");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const investedCost = liveRows.reduce");
  });

  it("reloads the dashboard when a position opens, closes or changes", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("function positionSignature");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("nextSignature !== lastPositionSignature");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("window.location.replace");
  });

  it("shows an explicit timestamp on every live position card", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("Ticker actualizado");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("cada 2,5 s");
  });
});

describe("DEMO live position valuation (single unit, single scale)", () => {
  it("scales the live per-position value and cost, not just the aggregate summary", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("function accountScale()");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("function positionValuation(quantity, bid, costEur, scale)");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const value = quantity * bid * scale;");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const cost = costEur * scale;");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("updateCard(strategy, ticker, scale)");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("positionValuation(quantity, ticker.bid, num(position.costEur), scale)");
  });

  it("never sums already-scaled live rows a second time in the summary", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("updateSummary(liveRows, expectedOpenPositions, scale)");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const liveValue = liveRows.reduce((sum, row) => sum + row.value, 0);");
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("const investedCost = liveRows.reduce((sum, row) => sum + row.cost, 0);");
    expect(DEMO_LIVE_PRICES_SCRIPT).not.toContain("liveRows.reduce((sum, row) => sum + row.value, 0) * scale");
    expect(DEMO_LIVE_PRICES_SCRIPT).not.toContain("liveRows.reduce((sum, row) => sum + row.cost, 0) * scale");
  });

  it("computes account scale from the same formula the static summary uses (norm())", () => {
    expect(DEMO_LIVE_PRICES_SCRIPT).toContain("initial > 0 ? 50 / initial : 1");
    const scaleSource = DEMO_LIVE_PRICES_SCRIPT.slice(
      DEMO_LIVE_PRICES_SCRIPT.indexOf("function accountScale()"),
      DEMO_LIVE_PRICES_SCRIPT.indexOf("// Valoración pura"),
    );
    expect(scaleSource).toContain("reduce((sum, item) => sum + num(item.initialCashEur), 0)");
  });
});

describe("DEMO live position valuation — numeric regression (multiple open positions)", () => {
  function loadValuation(): (quantity: number, bid: number, costEur: number, scale: number) => {
    value: number;
    cost: number;
    openPnl: number;
  } {
    const num = "const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;";
    const start = DEMO_LIVE_PRICES_SCRIPT.indexOf("function positionValuation");
    const end = DEMO_LIVE_PRICES_SCRIPT.indexOf("function positionSignature");
    const positionValuationSource = DEMO_LIVE_PRICES_SCRIPT.slice(start, end);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(`${num}\n${positionValuationSource}\nreturn positionValuation;`);
    return factory();
  }

  function loadAccountScale(): (strategies: Array<{ initialCashEur: number }>) => number {
    // Extracts the verbatim shipped function (no rewriting) and supplies the
    // one free variable it reads (`latestLab`) exactly as the real script
    // structure does, so the test exercises the actual production formula.
    const num = "const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;";
    const start = DEMO_LIVE_PRICES_SCRIPT.indexOf("function accountScale()");
    const end = DEMO_LIVE_PRICES_SCRIPT.indexOf("// Valoración pura");
    const accountScaleSource = DEMO_LIVE_PRICES_SCRIPT.slice(start, end);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      `${num}\nreturn function(strategies){let latestLab={state:{strategies}};\n${accountScaleSource}\nreturn accountScale();};`,
    );
    return factory();
  }

  it("keeps live and static valuations in the exact same unit across several simultaneous open positions", () => {
    const positionValuation = loadValuation();
    const accountScale = loadAccountScale();

    // Nine independently-simulated research strategies, each with its own
    // 50 EUR technical capital — matches research-lab.ts's per-strategy
    // initialCashEur, and forces a non-trivial scale (not 1) to the 50 EUR
    // equivalent account, exactly like the deployed lab.
    const strategies = Array.from({ length: 9 }, () => ({ initialCashEur: 50 }));
    const scale = accountScale(strategies);
    expect(scale).toBeCloseTo(50 / 450, 10);

    // Three simultaneous open positions with different sizes and prices.
    const openPositions = [
      { quantity: 0.0001657, bid: 62_100, costEur: 10.02 },
      { quantity: 0.05, bid: 190.4, costEur: 9.6 },
      { quantity: 3.2, bid: 3.11, costEur: 9.95 },
    ];

    for (const position of openPositions) {
      const { value, cost, openPnl } = positionValuation(position.quantity, position.bid, position.costEur, scale);
      const expectedValue = position.quantity * position.bid * scale;
      const expectedCost = position.costEur * scale;
      expect(value).toBeCloseTo(expectedValue, 10);
      expect(cost).toBeCloseTo(expectedCost, 10);
      expect(openPnl).toBeCloseTo(expectedValue - expectedCost, 10);

      // The regression this guards against: computing the live value/cost
      // WITHOUT the scale (the original bug) would be roughly 9x larger for
      // this 9-strategy cohort — never equal to the correctly scaled figure
      // unless the position happens to be worthless.
      const unscaledValue = position.quantity * position.bid;
      if (unscaledValue > 0) {
        expect(value).not.toBeCloseTo(unscaledValue, 5);
      }
    }
  });

  it("never produces a live position value using an unscaled (raw technical) magnitude", () => {
    const positionValuation = loadValuation();
    const scale = 50 / 450;
    const { value, cost } = positionValuation(0.0001657, 62_100, 10.02, scale);

    // Regression guard for the exact production symptom: a ~10 EUR technical
    // position must resolve to roughly 1.11 EUR once scaled to the 50 EUR
    // equivalent account (10.02 * 50/450 ≈ 1.1133), not ~10 EUR live next to
    // ~1.11 EUR static for the same position.
    expect(cost).toBeCloseTo(1.1133, 3);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(5);
  });
});
