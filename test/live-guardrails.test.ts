import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ORDER_NOTIONAL_EUR,
  defaultLiveGuardrailConfig,
  evaluateLiveGuardrails,
  liveTradingEnabledFromEnv,
  validateOrderIntent,
  type LiveGuardrailContext,
} from "../src/live-guardrails";

function context(overrides: Partial<LiveGuardrailContext> = {}): LiveGuardrailContext {
  return {
    orderIntent: "open",
    pair: "XBTEUR",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
    hasActiveOrder: false,
    inventoryQuantityBase: 0,
    inventoryReservedQuantityBase: 0,
    inventoryPair: null,
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
    const blockedOpen = evaluateLiveGuardrails(
      config,
      context({ inventoryQuantityBase: 0.0001, inventoryPair: "XBTEUR", orderIntent: "open" }),
    );
    expect(blockedOpen.allowed).toBe(false);
    expect(blockedOpen.blockers).toContain("Ya existe una posición abierta (límite estructural de una sola posición)");

    const allowedClose = evaluateLiveGuardrails(
      config,
      context({ inventoryQuantityBase: 0.0001, inventoryPair: "XBTEUR", orderIntent: "close", volumeBase: 0.0001 }),
    );
    expect(allowedClose.allowed).toBe(true);
  });

  it("blocks a close order when there is nothing open to close", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context({ inventoryQuantityBase: 0, orderIntent: "close" }));
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("No hay posición abierta que cerrar");
  });

  it("blocks selling a different asset than the one actually held", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(
      config,
      context({
        pair: "ETHEUR",
        orderIntent: "close",
        inventoryQuantityBase: 1,
        inventoryPair: "XBTEUR",
        volumeBase: 1,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.blockers.some((blocker) => blocker.includes("no de ETHEUR"))).toBe(true);
  });

  it("blocks selling more than the real available (non-reserved) inventory", () => {
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(
      config,
      context({
        orderIntent: "close",
        inventoryQuantityBase: 1,
        inventoryReservedQuantityBase: 0.5,
        inventoryPair: "XBTEUR",
        volumeBase: 0.6,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("La venta solicitada supera el inventario real disponible del activo");
  });

  it("enforces the configurable maximum order size, 5 EUR by default", () => {
    expect(DEFAULT_MAX_ORDER_NOTIONAL_EUR).toBe(5);
    const config = defaultLiveGuardrailConfig({ liveTradingEnabled: true });
    const result = evaluateLiveGuardrails(config, context({ notionalEur: 5.01, volumeBase: 0.0001002 }));
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

  describe("validateOrderIntent: strict input validation", () => {
    const config = defaultLiveGuardrailConfig();

    it("rejects non-finite or non-positive numbers", () => {
      expect(validateOrderIntent({ pair: "XBTEUR", volumeBase: 0, limitPrice: 50_000, notionalEur: 5 }, config))
        .toContain("volumeBase debe ser un número finito y positivo");
      expect(validateOrderIntent({ pair: "XBTEUR", volumeBase: Number.NaN, limitPrice: 50_000, notionalEur: 5 }, config))
        .toContain("volumeBase debe ser un número finito y positivo");
      expect(validateOrderIntent({ pair: "XBTEUR", volumeBase: 0.0001, limitPrice: -1, notionalEur: 5 }, config))
        .toContain("limitPrice debe ser un número finito y positivo");
      expect(validateOrderIntent({ pair: "XBTEUR", volumeBase: 0.0001, limitPrice: 50_000, notionalEur: Number.POSITIVE_INFINITY }, config))
        .toContain("notionalEur debe ser un número finito y positivo");
    });

    it("rejects a pair outside the allow-list", () => {
      expect(validateOrderIntent({ pair: "DOGEEUR", volumeBase: 1, limitPrice: 0.1, notionalEur: 0.1 }, config))
        .toContain("Par no permitido: DOGEEUR");
    });

    it("rejects volumeBase × limitPrice inconsistent with the declared notionalEur", () => {
      const blockers = validateOrderIntent({ pair: "XBTEUR", volumeBase: 1, limitPrice: 50_000, notionalEur: 5 }, config);
      expect(blockers.some((blocker) => blocker.includes("no coincide con notionalEur"))).toBe(true);
    });

    it("accepts a coherent, well-formed request", () => {
      expect(validateOrderIntent({ pair: "XBTEUR", volumeBase: 0.0001, limitPrice: 50_000, notionalEur: 5 }, config))
        .toEqual([]);
    });
  });
});
