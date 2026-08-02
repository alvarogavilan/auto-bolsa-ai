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
