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

function effectiveFees(takerRate = 0.008, checkedAt = NOW, pair = "XXBTZEUR") {
  return {
    schemaVersion: "kraken-effective-fees-v1" as const,
    checkedAt,
    pairRequested: "XBTEUR",
    currency: "ZEUR",
    volume30d: 0,
    maker: null,
    taker: {
      pair,
      percent: takerRate * 100,
      rate: takerRate,
      minPercent: null,
      maxPercent: null,
      nextPercent: null,
      tierVolume: null,
      nextVolume: null,
    },
    assumedPaperFeeEachSidePct: 0.4,
    paperFeeMatchesCurrentTaker: false,
    recommendedPaperFeeEachSideRate: takerRate,
    networkCallToKraken: true as const,
    readOnly: true as const,
    realOrderCreated: false as const,
    liveTrading: false as const,
  };
}

function safety(takerRate = 0.008) {
  return {
    connection: {
      checkedAt: NOW,
      configured: true,
      connected: true,
      effectiveFees: effectiveFees(takerRate),
      effectiveFeesError: null,
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

function accountAudit(balance: number) {
  return {
    schemaVersion: "kraken-account-cleanliness-v1" as const,
    checkedAt: NOW,
    eurBalance: balance,
    nonZeroAssetCount: balance > 0 ? 1 : 0,
    nonEurAssetCount: 0,
    openOrderCount: 0,
    accountCleanForBaseline: true,
    blockers: [],
    nonceRequests: 2 as const,
    networkCallsToKraken: 2 as const,
    readOnly: true as const,
    realOrderCreated: false as const,
    liveTrading: false as const,
  };
}

function dependencies(
  overrides: Partial<PilotValidationProposalDependencies> = {},
): PilotValidationProposalDependencies {
  return {
    safety: safety(),
    accountAudit: accountAudit(10),
    resolution,
    tickers: { XXBTZEUR: ticker },
    pair: "XBTEUR",
    now: NOW,
    idempotencyKey: "server-key",
    ...overrides,
  };
}

describe("server-built validation proposal", () => {
  it("never exceeds the 10 EUR cap or half the balance", () => {
    const proposal = buildPilotValidationProposal(dependencies());
    expect(proposal.request.pair).toBe("XBTEUR");
    expect(proposal.grossBudgetEur).toBe(5);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(10);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(10 * 0.5);
    expect(proposal.request.idempotencyKey).toBe("server-key");
    expect(proposal.validateOnly).toBe(true);
    expect(proposal.realOrderCreated).toBe(false);
  });

  it("reserves effective taker fee plus buffer and quantizes price and volume", () => {
    const proposal = buildPilotValidationProposal(dependencies({
      accountAudit: accountAudit(20),
      safety: safety(0.008),
      idempotencyKey: "server-key-2",
    }));
    expect(proposal.effectiveTakerFeeRate).toBe(0.008);
    expect(proposal.feeReserveBufferRate).toBe(0.0025);
    expect(proposal.feeReservePct).toBeCloseTo(0.0105, 10);
    expect(proposal.feeAuditCheckedAt).toBe(NOW);
    expect(proposal.request.limitPrice).toBe(50_000.1);
    expect(proposal.request.volumeBase.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(8);
    expect(proposal.request.volumeBase * proposal.request.limitPrice).toBeLessThanOrEqual(10 * (1 - 0.0105) + 1e-6);
    expect(proposal.request.volumeBase).toBeGreaterThanOrEqual(resolution.metadata.orderMinBase);
  });

  it("never reduces the reserve below one percent for a low fee tier", () => {
    const proposal = buildPilotValidationProposal(dependencies({
      safety: safety(0.002),
      idempotencyKey: "low-fee-tier",
    }));
    expect(proposal.feeReservePct).toBe(0.01);
  });

  it("uses 50% of smaller balances before the dynamic fee reserve", () => {
    const proposal = buildPilotValidationProposal(dependencies({
      accountAudit: accountAudit(4),
      tickers: { XXBTZEUR: { ...ticker, ask: 1_000, bid: 999 } },
      idempotencyKey: "small-balance",
    }));
    expect(proposal.grossBudgetEur).toBe(2);
    expect(proposal.request.notionalEur).toBeLessThanOrEqual(2 * (1 - proposal.feeReservePct) + 1e-6);
  });

  it("blocks missing, stale, wrong-pair or abnormal effective fees", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(),
        connection: { ...safety().connection, effectiveFees: null, effectiveFeesError: "permission denied" },
      },
      idempotencyKey: "missing-fees",
    }))).toThrow(/tarifa efectiva.*no está disponible/i);

    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(),
        connection: {
          ...safety().connection,
          effectiveFees: effectiveFees(0.008, NOW - 16 * 60_000),
        },
      },
      idempotencyKey: "stale-fees",
    }))).toThrow(/caducada/i);

    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(),
        connection: {
          ...safety().connection,
          effectiveFees: effectiveFees(0.008, NOW, "ETHZEUR"),
        },
      },
      idempotencyKey: "wrong-pair-fees",
    }))).toThrow(/no corresponde/i);

    expect(() => buildPilotValidationProposal(dependencies({
      safety: safety(0.051),
      idempotencyKey: "abnormal-fees",
    }))).toThrow(/fuera del rango/i);
  });

  it("requires a clean EUR-only account baseline", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      accountAudit: { ...accountAudit(10), nonEurAssetCount: 1, accountCleanForBaseline: false },
      idempotencyKey: "dirty-account",
    }))).toThrow(/activos adicionales/i);
  });

  it("blocks prior open orders", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      accountAudit: { ...accountAudit(10), openOrderCount: 1, accountCleanForBaseline: false },
      idempotencyKey: "open-orders",
    }))).toThrow(/órdenes abiertas/i);
  });

  it("blocks an abnormally wide public spread", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      tickers: { XXBTZEUR: { ...ticker, ask: 50_000, bid: 49_000 } },
      idempotencyKey: "wide-spread",
    }))).toThrow(/spread público demasiado amplio/i);
  });

  it("fails closed for unsafe permissions, missing ticker or insufficient minimum", () => {
    expect(() => buildPilotValidationProposal(dependencies({
      safety: {
        ...safety(),
        permissions: { ...safety().permissions, safePermissions: false },
      },
      idempotencyKey: "unsafe-permissions",
    }))).toThrow(/permisos Kraken/i);

    expect(() => buildPilotValidationProposal(dependencies({
      tickers: {},
      idempotencyKey: "missing-ticker",
    }))).toThrow(/ticker público/i);

    expect(() => buildPilotValidationProposal(dependencies({
      accountAudit: accountAudit(0.05),
      tickers: { XXBTZEUR: { ...ticker, ask: 50_000, bid: 49_990 } },
      idempotencyKey: "below-minimum",
    }))).toThrow(/mínimo de Kraken/i);
  });
});
