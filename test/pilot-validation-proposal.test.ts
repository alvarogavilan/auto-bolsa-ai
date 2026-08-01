import { describe, expect, it } from "vitest";
import {
  buildPilotValidationProposal,
  type PilotValidationProposalDependencies,
} from "../src/pilot-validation-proposal";

const NOW = 1_800_000_000_000;
const resolution = {
  requestedPair: "XBTEUR",
  canonicalPair: "XXBTZEUR",
  acceptedPairCodes: ["XXBTZEUR", "XBT/EUR", "XBTEUR"],
  metadata: { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 },
};
const ticker = {
  ask: 50_000.04,
  bid: 49_990,
  last: 49_995,
  volume24h: 100,
  vwap24h: 49_000,
  trades24h: 1_000,
  low24h: 48_000,
  high24h: 51_000,
  open24h: 49_500,
};

function safety(balance: number) {
  return {
    connection: {
      checkedAt: NOW,
      configured: true,
      connected: true,
      eurBalance: balance,
      nonZeroAssetCount: 1,
      error: null,
    },
    permissions: {
      checkedAt: NOW,
      auditComplete: true,
      safePermissions: true,
      withdrawalPermission: false,
      depositPermission: false,
      earnPermission: false,
      error: null,
    },
  };
}

function dependencies(
  overrides: Partial<PilotValidationProposalDependencies> = {},
): PilotValidationProposalDependencies {
  return {
    safety: safety(10),
    openOrderCount: 0,
    resolution,
    tickers: { XXBTZEUR: ticker },
    pair: "XBTEUR",
    now: NOW,
    idempotencyKey: "server-key",
    ...overrides,
  };
}

describe("server-built validation proposal", () => {
  it("uses configured pair aliases and never exceeds 5 EUR or half the balance", () => {
    const proposal = buildPilotValidationProposal(dependencies());
    expect(proposal.request.pair).toBe("XBTEUR");
    expect(proposal.openOrderCount).toBe(0);
    expect(proposal.grossBudgetEur).toBe(5);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(5);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(10 * 0.5);
    expect(proposal.request.idempotencyKey).toBe("server-key");
    expect(proposal.validateOnly).toBe(true);
    expect(proposal.realOrderCreated).toBe(false);
  });

  it("reserves commission margin and quantizes price up and volume down", () => {
    const proposal = buildPilotValidationProposal(dependencies({
      safety: safety(20),
      idempotencyKey: "server-key-2",
    }));
    expect(proposal.request.limitPrice).toBe(50_000.1);
    expect(proposal.request.volumeBase.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(8);
    expect(proposal.request.volumeBase * proposal.request.limitPrice).toBeLessThanOrEqual(4.95 + 1e-6);
    expect(proposal.request.volumeBase).toBeGreaterThanOrEqual(resolution.metadata.orderMinBase);
  });

  it("uses 50% of smaller balances before the fee reserve", () => {
    const proposal = buildPilotValidationProposal(dependencies({
      safety: safety(4),
      tickers: { XXBTZEUR: { ...ticker, ask: 1_000, bid: 999 } },
      idempotencyKey: "small-balance",
    }));
    expect(proposal.grossBudgetEur).toBe(2);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(1.98 + 1e-6);
  });

  it("requires a clean EUR-only account baseline", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(10),
        connection: { ...safety(10).connection, nonZeroAssetCount: 2 },
      },
      idempotencyKey: "existing-assets",
    }))).toThrow(/activos adicionales|inventario/i);

    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(10),
        connection: { ...safety(10).connection, nonZeroAssetCount: null },
      },
      idempotencyKey: "unknown-assets",
    }))).toThrow(/inventario no es verificable/i);
  });

  it("requires a verified zero-open-order Kraken account", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      openOrderCount: 1,
      idempotencyKey: "open-order",
    }))).toThrow(/órdenes abiertas/i);

    expect(() => buildPilotValidationProposal(dependencies({
      openOrderCount: Number.NaN,
      idempotencyKey: "unknown-open-orders",
    }))).toThrow(/verificar.*órdenes abiertas/i);
  });

  it("blocks an abnormally wide public spread", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      tickers: { XXBTZEUR: { ...ticker, ask: 110, bid: 90 } },
      idempotencyKey: "wide-spread",
    }))).toThrow(/spread.*amplio/i);
  });

  it("fails closed for unsafe permissions, missing ticker or insufficient minimum", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      safety: { ...safety(10), permissions: { ...safety(10).permissions, safePermissions: false } },
      idempotencyKey: "unsafe",
    }))).toThrow(/permisos/i);

    expect(() => buildPilotValidationProposal(dependencies({
      tickers: {},
      idempotencyKey: "missing",
    }))).toThrow(/ticker/i);

    expect(() => buildPilotValidationProposal(dependencies({
      safety: safety(1),
      resolution: { ...resolution, metadata: { ...resolution.metadata, orderMinBase: 1 } },
      idempotencyKey: "minimum",
    }))).toThrow(/mínimo/i);
  });
});
