import { describe, expect, it } from "vitest";
import type { LiveOrder } from "../src/live-executor";
import type { KrakenAssetPair, KrakenTicker } from "../src/kraken-markets";
import {
  createLivePreflightCertificate,
  DEFAULT_PREFLIGHT_CERTIFICATE_TTL_MS,
  type LivePreflightCertificate,
} from "../src/live-preflight-certificate";
import type { LiveOrderPreflightIntent, LiveOrderPreflightResult } from "../src/live-order-preflight";
import {
  computePilotValidationProposal,
  preflightCertificateDisplayStatus,
  type PilotValidationComputationInputs,
} from "../src/pilot-validation";

const NOW = 1_800_000_000_000;

function assetPair(overrides: Partial<KrakenAssetPair> = {}): KrakenAssetPair {
  return {
    key: "XXBTZEUR",
    altname: "XBTEUR",
    wsname: "XBT/EUR",
    base: "XXBT",
    quote: "ZEUR",
    ordermin: 0.00005,
    costmin: 0.5,
    pairDecimals: 1,
    lotDecimals: 8,
    tickSize: 0.1,
    status: "online",
    ...overrides,
  };
}

function ticker(overrides: Partial<KrakenTicker> = {}): KrakenTicker {
  return {
    ask: 50_000,
    bid: 49_950,
    last: 49_975,
    volume24h: 100,
    vwap24h: 49_980,
    trades24h: 10,
    low24h: 49_000,
    high24h: 51_000,
    open24h: 49_500,
    ...overrides,
  };
}

function baseInputs(overrides: Partial<PilotValidationComputationInputs> = {}): PilotValidationComputationInputs {
  return {
    pair: "XBTEUR",
    krakenConnected: true,
    krakenPermissionsSafe: true,
    eurBalance: 10,
    assetPairs: [assetPair()],
    tickers: { XXBTZEUR: ticker() },
    idempotencyKeyFactory: () => "deterministic-key",
    ...overrides,
  };
}

describe("computePilotValidationProposal (Pruebas obligatorias #5 y #6)", () => {
  it("blocks when Kraken is not connected", () => {
    const result = computePilotValidationProposal(baseInputs({ krakenConnected: false }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.join(" ")).toMatch(/no está conectado/);
  });

  it("blocks when permissions are not audited as safe", () => {
    const result = computePilotValidationProposal(baseInputs({ krakenPermissionsSafe: false }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.join(" ")).toMatch(/permisos/);
  });

  it("blocks when there is no positive real EUR balance", () => {
    expect(computePilotValidationProposal(baseInputs({ eurBalance: null }), NOW).ok).toBe(false);
    expect(computePilotValidationProposal(baseInputs({ eurBalance: 0 }), NOW).ok).toBe(false);
    expect(computePilotValidationProposal(baseInputs({ eurBalance: -3 }), NOW).ok).toBe(false);
  });

  it("takes the pair exclusively from the inputs the server derived from env.PAIR, never from a client-supplied value", () => {
    // La única forma de influir en el par es el propio parámetro `pair` de
    // entrada, que en el envoltorio async (`buildPilotValidationProposal`)
    // proviene siempre de `env.PAIR`. La función no lee ningún otro origen.
    const result = computePilotValidationProposal(baseInputs({ pair: "XBTEUR" }), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.pair).toBe("XXBTZEUR");
  });

  it("caps the budget at 5 EUR even with a very large balance", () => {
    const result = computePilotValidationProposal(baseInputs({ eurBalance: 1_000 }), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.notionalEur).toBeLessThanOrEqual(5);
      expect(result.proposal.eurBalance).toBe(1_000);
    }
  });

  it("caps the budget at 50% of the balance when the balance is below 10 EUR", () => {
    // Saldo real de ~6 €: 50% = 3 €, menos margen de comisión (0,4%) = 2,988 €.
    const result = computePilotValidationProposal(
      baseInputs({ eurBalance: 6, tickers: { XXBTZEUR: ticker({ ask: 100, bid: 99.9 }) } }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.notionalEur).toBeLessThanOrEqual(3);
      expect(result.proposal.notionalEur).toBeGreaterThan(2.9);
    }
  });

  it("quantizes price to priceDecimals and volume floored to lotDecimals, never exceeding the budget", () => {
    const result = computePilotValidationProposal(
      baseInputs({ tickers: { XXBTZEUR: ticker({ ask: 50_000.07, bid: 49_950 }) } }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.limitPrice).toBe(50_000.1); // redondeado a 1 decimal (pairDecimals)
      // volumen truncado hacia abajo a 8 decimales (lotDecimals), nunca al alza
      expect(Number((result.proposal.volumeBase * result.proposal.limitPrice).toPrecision(15)))
        .toBeLessThanOrEqual(5);
      expect(result.proposal.volumeBase).toBeCloseTo(Math.floor((result.proposal.volumeBase) * 1e8) / 1e8, 10);
    }
  });

  it("blocks when the spread exceeds the maximum tolerated (1%)", () => {
    const result = computePilotValidationProposal(
      baseInputs({ tickers: { XXBTZEUR: ticker({ ask: 51_000, bid: 49_000 }) } }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.join(" ")).toMatch(/spread/i);
  });

  it("fails closed for an unknown or non-online pair", () => {
    const result = computePilotValidationProposal(
      baseInputs({ pair: "DOGEEUR", assetPairs: [assetPair({ status: "cancel_only" })] }),
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed when there is no valid public ticker for the resolved pair", () => {
    const result = computePilotValidationProposal(baseInputs({ tickers: {} }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.join(" ")).toMatch(/ticker/);
  });

  it("generates a fresh idempotencyKey and never reuses volume/price/balance from a prior call", () => {
    let counter = 0;
    const inputs = baseInputs({ idempotencyKeyFactory: () => `key-${++counter}` });
    const first = computePilotValidationProposal(inputs, NOW);
    const second = computePilotValidationProposal(inputs, NOW + 1_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.proposal.idempotencyKey).not.toBe(second.proposal.idempotencyKey);
    }
  });

  it("never proposes anything but a buy, structurally", () => {
    const result = computePilotValidationProposal(baseInputs(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.side).toBe("buy");
  });
});

describe("preflightCertificateDisplayStatus (Pruebas obligatorias: absent/valid/expired/consumed/invalid)", () => {
  const intent: LiveOrderPreflightIntent = {
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
  };

  function order(overrides: Partial<LiveOrder> = {}): LiveOrder {
    return {
      clOrdId: "cl-ord-1",
      idempotencyKey: "idem-1",
      exchangeOrderId: null,
      request: { idempotencyKey: "idem-1", ...intent },
      status: "prepared",
      filledVolumeBase: 0,
      averageFillPrice: null,
      attempts: 0,
      createdAt: NOW,
      updatedAt: NOW,
      transitions: [],
      ...overrides,
    };
  }

  async function certificateFor(clOrdId: string, ttlMs = DEFAULT_PREFLIGHT_CERTIFICATE_TTL_MS): Promise<LivePreflightCertificate> {
    const result: LiveOrderPreflightResult = {
      status: "validated",
      checkedAt: NOW,
      contactedKraken: true,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      clOrdId,
      blockers: [],
      message: "ok",
      description: null,
      anomaly: null,
    };
    return createLivePreflightCertificate(intent, result, { ttlMs });
  }

  it("reports absent when there is no certificate or no order", async () => {
    expect(await preflightCertificateDisplayStatus(null, order(), NOW)).toBe("absent");
    const certificate = await certificateFor("cl-ord-1");
    expect(await preflightCertificateDisplayStatus(certificate, null, NOW)).toBe("absent");
  });

  it("reports valid for a fresh, unconsumed certificate matching the order exactly", async () => {
    const certificate = await certificateFor("cl-ord-1");
    expect(await preflightCertificateDisplayStatus(certificate, order(), NOW)).toBe("valid");
  });

  it("reports consumed once consumedAt is set, even before expiry", async () => {
    const certificate = await certificateFor("cl-ord-1");
    const consumed = { ...certificate, consumedAt: NOW };
    expect(await preflightCertificateDisplayStatus(consumed, order(), NOW)).toBe("consumed");
  });

  it("reports expired once the clock passes expiresAt, while still unconsumed", async () => {
    const certificate = await certificateFor("cl-ord-1", 1_000);
    expect(await preflightCertificateDisplayStatus(certificate, order(), NOW + 5_000)).toBe("expired");
  });

  it("reports invalid when the stored certificate no longer matches the order it is checked against", async () => {
    const certificate = await certificateFor("cl-ord-1");
    const mismatchedOrder = order({ request: { idempotencyKey: "idem-1", ...intent, volumeBase: 0.0002 } });
    expect(await preflightCertificateDisplayStatus(certificate, mismatchedOrder, NOW)).toBe("invalid");
  });
});
