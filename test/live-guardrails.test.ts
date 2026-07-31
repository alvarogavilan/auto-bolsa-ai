import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ORDER_NOTIONAL_EUR,
  defaultLiveGuardrailConfig,
  evaluateLiveGuardrails,
  liveTradingEnabledFromEnv,
  type LiveGuardrailContext,
} from "../src/live-guardrails";

function context(overrides: Partial<LiveGuardrailContext> = {}): LiveGuardrailContext {
  return {
    orderIntent: "open",
    hasActiveOrder: false,
    hasOpenPosition: false,
    requestedNotionalEur: 5,
    dayStartEquityEur: 50,
    currentEquityEur: 50,
    peakEquityEur: 50,
    consecutiveTransportErrors: 0,
    lastMarketDataAt: Date.now(),
    emergencyStopActive: false,
    ...overrides,
  };
}

describe("live guardrails", () => {
  it("never treats an absent or false LIVE_TRADING_ENABLED as enabled", () => {
    expect(liveTradingEnabledFromEnv(undefined)).toBe(false);
    expect(liveTradingEnabledFromEnv("false")).toBe(false);
    expect(liveTradingEnabledFromEnv("TRUE")).toBe(false);
    expect(liveTradingEnabledFromEnv("1")).toBe(false);
    expect(liveTradingEnabledFromEnv("true")).toBe(true);
  });

  it("blocks everything by default even when every other condition is favourable", () => {
    const config = defaultLiveGuardrailConfig();
    const result = evaluateLiveGuardrails(config, context());
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("LIVE_TRADING_ENABLED no está activado");
  });

  it("still blocks when live trading is enabled but an order is already active", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context({ hasActiveOrder: true }));
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("Ya existe una orden activa (límite estructural de una sola orden)");
  });

  it("blocks a second position opening but allows closing the existing one", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const blockedOpen = evaluateLiveGuardrails(config, context({ hasOpenPosition: true, orderIntent: "open" }));
    expect(blockedOpen.allowed).toBe(false);
    expect(blockedOpen.blockers).toContain("Ya existe una posición abierta (límite estructural de una sola posición)");

    const allowedClose = evaluateLiveGuardrails(config, context({ hasOpenPosition: true, orderIntent: "close" }));
    expect(allowedClose.allowed).toBe(true);
  });

  it("blocks a close order when there is nothing open to close", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context({ hasOpenPosition: false, orderIntent: "close" }));
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("No hay posición abierta que cerrar");
  });

  it("enforces the configurable maximum order size, 5 EUR by default", () => {
    expect(DEFAULT_MAX_ORDER_NOTIONAL_EUR).toBe(5);
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context({ requestedNotionalEur: 5.01 }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.some((blocker) => blocker.includes("supera el máximo"))).toBe(true);
  });

  it("blocks on daily loss and drawdown limits", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const dailyLoss = evaluateLiveGuardrails(config, context({ dayStartEquityEur: 50, currentEquityEur: 49.4 }));
    expect(dailyLoss.allowed).toBe(false);
    expect(dailyLoss.blockers).toContain("Límite de pérdida diaria alcanzado");

    const drawdown = evaluateLiveGuardrails(config, context({ peakEquityEur: 50, currentEquityEur: 47.4 }));
    expect(drawdown.allowed).toBe(false);
    expect(drawdown.blockers).toContain("Límite de drawdown alcanzado");
  });

  it("blocks on stale or missing market data", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const missing = evaluateLiveGuardrails(config, context({ lastMarketDataAt: null }));
    expect(missing.allowed).toBe(false);
    expect(missing.blockers).toContain("Datos de mercado obsoletos o ausentes");

    const stale = evaluateLiveGuardrails(
      config,
      context({ lastMarketDataAt: Date.now() - 10 * 60_000 }),
    );
    expect(stale.allowed).toBe(false);
  });

  it("blocks after too many consecutive transport errors and during an emergency stop", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const errorBreaker = evaluateLiveGuardrails(config, context({ consecutiveTransportErrors: 3 }));
    expect(errorBreaker.allowed).toBe(false);
    expect(errorBreaker.blockers).toContain("Demasiados errores consecutivos de transporte");

    const emergency = evaluateLiveGuardrails(config, context({ emergencyStopActive: true }));
    expect(emergency.allowed).toBe(false);
    expect(emergency.blockers).toContain("Parada de emergencia activa");
  });

  it("allows a well-formed order once every gate is satisfied", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context());
    expect(result).toEqual({ allowed: true, blockers: [] });
  });
});
