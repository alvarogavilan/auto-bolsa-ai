import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifestPilotDashboard } from "../src/pilot-dashboard-manifest";
import { buildPilotOneShotManifest } from "../src/pilot-one-shot-manifest";

const ROOT = process.cwd();
const NOW = 1_800_000_000_000;

function readiness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: NOW - 1_000,
    infrastructureEligibleForManualReview: true,
    submissionEndpointAvailable: false,
    submissionArmed: false,
    liveTrading: false,
    maximumOrderNotionalEur: 5,
    executor: {
      order: {
        clOrdId: "pilot-order-1",
        status: "prepared",
        pair: "XBTEUR",
        side: "buy",
        volumeBase: 0.0001,
        limitPrice: 50_000,
        notionalEur: 5,
      },
    },
    preflightCertificate: {
      status: "valid",
      certificateId: "certificate-1",
      expiresAt: NOW + 90_000,
    },
    accountCleanliness: {
      schemaVersion: "kraken-account-cleanliness-v1",
      accountCleanForBaseline: true,
      checkedAt: NOW - 500,
      eurBalance: 10,
      nonEurAssetCount: 0,
      openOrderCount: 0,
    },
    fireDrill: {
      passed: true,
      passedChecks: 6,
      totalChecks: 6,
      generatedAt: NOW - 200,
    },
    ...overrides,
  };
}

function connection(takerPercent: number | null = 0.4): Record<string, unknown> {
  return {
    effectiveFees: takerPercent === null
      ? null
      : { taker: { percent: takerPercent } },
  };
}

describe("pilot one-shot manifest", () => {
  it("seals a complete eligible dossier without creating execution capability", async () => {
    const manifest = await buildPilotOneShotManifest(readiness(), connection(), NOW);

    expect(manifest.schemaVersion).toBe("pilot-one-shot-manifest-v1");
    expect(manifest.eligibleForHumanArming).toBe(true);
    expect(manifest.blockers).toEqual([]);
    expect(manifest.manifestId).toHaveLength(24);
    expect(manifest.payloadHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.generatedAt).toBe(NOW);
    expect(manifest.expiresAt).toBe(NOW + 90_000);
    expect(manifest.order).toEqual({
      clOrdId: "pilot-order-1",
      pair: "XBTEUR",
      side: "buy",
      volumeBase: 0.0001,
      limitPrice: 50_000,
      notionalEur: 5,
    });
    expect(manifest.economics.takerFeePercent).toBe(0.4);
    expect(manifest.economics.estimatedRoundTripFeeEur).toBeCloseTo(0.04, 10);
    expect(manifest.economics.minimumReservedEur).toBeCloseTo(5.09, 10);
    expect(manifest.economics.reserveSatisfied).toBe(true);
    expect(manifest.singleOrderOnly).toBe(true);
    expect(manifest.requiresManualHumanAction).toBe(true);
    expect(manifest.authorizationToken).toBeNull();
    expect(manifest.persisted).toBe(false);
    expect(manifest.submitCapable).toBe(false);
    expect(manifest.realOrderCreated).toBe(false);
    expect(manifest.liveTrading).toBe(false);
  });

  it("produces a stable hash independent of object property order", async () => {
    const first = await buildPilotOneShotManifest(readiness(), connection(), NOW);
    const reordered = {
      liveTrading: false,
      submissionArmed: false,
      submissionEndpointAvailable: false,
      infrastructureEligibleForManualReview: true,
      fireDrill: {
        totalChecks: 6,
        generatedAt: NOW - 200,
        passedChecks: 6,
        passed: true,
      },
      accountCleanliness: {
        openOrderCount: 0,
        nonEurAssetCount: 0,
        eurBalance: 10,
        checkedAt: NOW - 500,
        accountCleanForBaseline: true,
        schemaVersion: "kraken-account-cleanliness-v1",
      },
      preflightCertificate: {
        expiresAt: NOW + 90_000,
        certificateId: "certificate-1",
        status: "valid",
      },
      executor: {
        order: {
          notionalEur: 5,
          limitPrice: 50_000,
          volumeBase: 0.0001,
          side: "buy",
          pair: "XBTEUR",
          status: "prepared",
          clOrdId: "pilot-order-1",
        },
      },
      maximumOrderNotionalEur: 5,
      generatedAt: NOW - 1_000,
    };
    const second = await buildPilotOneShotManifest(reordered, {
      effectiveFees: { taker: { percent: 0.4 } },
    }, NOW);

    expect(second.payloadHashSha256).toBe(first.payloadHashSha256);
    expect(second.manifestId).toBe(first.manifestId);
  });

  it("changes the seal when an order field changes", async () => {
    const first = await buildPilotOneShotManifest(readiness(), connection(), NOW);
    const changed = readiness({
      executor: {
        order: {
          clOrdId: "pilot-order-1",
          status: "prepared",
          pair: "XBTEUR",
          side: "buy",
          volumeBase: 0.0001,
          limitPrice: 50_001,
          notionalEur: 5,
        },
      },
    });
    const second = await buildPilotOneShotManifest(changed, connection(), NOW);

    expect(second.payloadHashSha256).not.toBe(first.payloadHashSha256);
  });

  it("never upgrades a blocked readiness report", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      infrastructureEligibleForManualReview: false,
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.blockers).toContain("El expediente base todavía no es elegible para revisión humana");
    expect(manifest.submitCapable).toBe(false);
  });

  it("blocks an order above five euros", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      executor: {
        order: {
          clOrdId: "pilot-order-1",
          status: "prepared",
          pair: "XBTEUR",
          side: "buy",
          volumeBase: 0.0002,
          limitPrice: 50_000,
          notionalEur: 10,
        },
      },
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 500,
        eurBalance: 20,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.blockers).toContain("La orden no respeta el máximo absoluto de 5 EUR");
  });

  it("blocks invalid or expired certificates", async () => {
    const invalid = await buildPilotOneShotManifest(readiness({
      preflightCertificate: {
        status: "invalid",
        certificateId: "certificate-1",
        expiresAt: NOW + 90_000,
      },
    }), connection(), NOW);
    const expired = await buildPilotOneShotManifest(readiness({
      preflightCertificate: {
        status: "valid",
        certificateId: "certificate-1",
        expiresAt: NOW - 1,
      },
    }), connection(), NOW);

    expect(invalid.eligibleForHumanArming).toBe(false);
    expect(invalid.blockers).toContain("El certificado validate=true no está vigente");
    expect(expired.eligibleForHumanArming).toBe(false);
    expect(expired.blockers).toContain("El certificado validate=true ha caducado");
  });

  it("blocks missing effective fees and insufficient exit reserve", async () => {
    const missingFee = await buildPilotOneShotManifest(readiness(), connection(null), NOW);
    const insufficientReserve = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 500,
        eurBalance: 5.05,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);

    expect(missingFee.blockers).toContain("La tarifa taker efectiva no está confirmada");
    expect(missingFee.economics.reserveSatisfied).toBe(false);
    expect(insufficientReserve.blockers).toContain("El saldo EUR no conserva la reserva mínima para costes y salida");
  });

  it("never serializes secrets, nonces or an authorization token", async () => {
    const manifest = await buildPilotOneShotManifest({
      ...readiness(),
      KRAKEN_API_KEY: "should-not-appear",
      KRAKEN_API_SECRET: "should-not-appear",
      nonce: "1800000000000",
    }, {
      ...connection(),
      apiKey: "should-not-appear",
      apiSecret: "should-not-appear",
    }, NOW);
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("should-not-appear");
    expect(serialized).not.toContain("1800000000000");
    expect(serialized).not.toContain("API-Sign");
    expect(manifest.authorizationToken).toBeNull();
  });

  it("renders a non-submitting iPhone manifest card with valid JavaScript", async () => {
    const response = await manifestPilotDashboard();
    const html = await response.text();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Manifiesto de una sola orden");
    expect(html).toContain("Generar manifiesto sellado");
    expect(html).toContain("/api/pilot/one-shot-manifest");
    expect(html).toContain("submitCapable=false");
    expect(html).toContain("Puede enviar");
    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("AddOrder");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("keeps the manifest endpoint private and the real submit routes untouched", () => {
    const adapter = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(adapter).toContain('url.pathname === "/api/pilot/one-shot-manifest"');
    expect(adapter).toContain("if (!isAuthorized(request, env))");
    expect(adapter).toContain("buildPilotOneShotManifest");
    expect(adapter).toContain('internalAuthorizedRequest(request, "/api/kraken/connection")');
    expect(core).toContain('url.pathname === "/api/pilot/submit"');
    expect(core).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(core).toContain('url.pathname.startsWith("/api/live")');
    expect(core).toContain("LIVE_TRADING_HARD_DISABLED");
  });
});
