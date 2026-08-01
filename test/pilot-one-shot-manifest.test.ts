import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifestPilotDashboard } from "../src/pilot-dashboard-manifest";
import { buildPilotOneShotManifest } from "../src/pilot-one-shot-manifest";

const ROOT = process.cwd();
const NOW = 1_800_000_000_000;
const SECRET_NONCE_FIXTURE = "9999999999999";

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
  it("seals a complete eligible dossier without execution capability", async () => {
    const manifest = await buildPilotOneShotManifest(readiness(), connection(), NOW);

    expect(manifest.schemaVersion).toBe("pilot-one-shot-manifest-v1");
    expect(manifest.eligibleForHumanArming).toBe(true);
    expect(manifest.blockers).toEqual([]);
    expect(manifest.manifestId).toHaveLength(24);
    expect(manifest.payloadHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.generatedAt).toBe(NOW);
    // El vencimiento por frescura de readiness.generatedAt (NOW - 1_000 + 30 s
    // de tolerancia) es ahora más estricto que el del certificado (NOW + 90 s):
    // el manifiesto nunca puede prometer validez más allá de la evidencia más
    // próxima a caducar (issue #83).
    expect(manifest.expiresAt).toBe(NOW - 1_000 + 30_000);
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

  it("keeps the hash stable across property ordering", async () => {
    const first = await buildPilotOneShotManifest(readiness(), connection(), NOW);
    const reordered = {
      liveTrading: false,
      submissionArmed: false,
      submissionEndpointAvailable: false,
      infrastructureEligibleForManualReview: true,
      fireDrill: { totalChecks: 6, generatedAt: NOW - 200, passedChecks: 6, passed: true },
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
    const second = await buildPilotOneShotManifest(
      reordered,
      { effectiveFees: { taker: { percent: 0.4 } } },
      NOW,
    );

    expect(second.payloadHashSha256).toBe(first.payloadHashSha256);
    expect(second.manifestId).toBe(first.manifestId);
  });

  it("changes the seal when any order field changes", async () => {
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
    const manifest = await buildPilotOneShotManifest(
      readiness({ infrastructureEligibleForManualReview: false }),
      connection(),
      NOW,
    );

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.blockers).toContain("El expediente base todavía no es elegible para revisión humana");
    expect(manifest.submitCapable).toBe(false);
  });

  it("blocks an order above the absolute five euro maximum", async () => {
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

  it("blocks invalid and expired certificates", async () => {
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

    expect(invalid.blockers).toContain("El certificado validate=true no está vigente");
    expect(expired.blockers).toContain("El certificado validate=true ha caducado");
    expect(invalid.eligibleForHumanArming).toBe(false);
    expect(expired.eligibleForHumanArming).toBe(false);
  });

  it("blocks missing fees and insufficient exit reserve", async () => {
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
      nonce: SECRET_NONCE_FIXTURE,
    }, {
      ...connection(),
      apiKey: "should-not-appear",
      apiSecret: "should-not-appear",
    }, NOW);
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("should-not-appear");
    expect(serialized).not.toContain(SECRET_NONCE_FIXTURE);
    expect(serialized).not.toContain("API-Sign");
    expect(manifest.authorizationToken).toBeNull();
  });

  it("renders a non-submitting iPhone card with valid JavaScript", async () => {
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

  it("keeps the endpoint private and real submit routes untouched", () => {
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

describe("pilot one-shot manifest: evidence freshness barriers (issue #83)", () => {
  it("Pruebas obligatorias #1: is eligible when every evidence timestamp was just generated", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      generatedAt: NOW - 1_000,
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 100,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
      fireDrill: { passed: true, passedChecks: 6, totalChecks: 6, generatedAt: NOW - 50 },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(true);
    expect(manifest.blockers).toEqual([]);
    expect(manifest.freshness.readiness.fresh).toBe(true);
    expect(manifest.freshness.account.fresh).toBe(true);
    expect(manifest.freshness.fireDrill.fresh).toBe(true);
    expect(manifest.freshness.account.ageMs).toBe(100);
  });

  it("Pruebas obligatorias #2: blocks a stale account cleanliness audit", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 31_000,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.freshness.account.fresh).toBe(false);
    expect(manifest.blockers.some((blocker) => blocker.includes("auditoría de cuenta") && blocker.includes("obsoleta"))).toBe(true);
  });

  it("Pruebas obligatorias #3: blocks a stale readiness report", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      generatedAt: NOW - 45_000,
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.freshness.readiness.fresh).toBe(false);
    expect(manifest.blockers.some((blocker) => blocker.includes("informe de preparación") && blocker.includes("obsoleta"))).toBe(true);
  });

  it("Pruebas obligatorias #4: blocks a stale fire drill", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      fireDrill: { passed: true, passedChecks: 6, totalChecks: 6, generatedAt: NOW - 60_000 },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.freshness.fireDrill.fresh).toBe(false);
    expect(manifest.blockers.some((blocker) => blocker.includes("simulacro integral") && blocker.includes("obsoleta"))).toBe(true);
  });

  it("Pruebas obligatorias #5: blocks a missing timestamp for any of the three evidences", async () => {
    const missingReadiness = await buildPilotOneShotManifest(readiness({ generatedAt: undefined }), connection(), NOW);
    const missingAccount = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);
    const missingFireDrill = await buildPilotOneShotManifest(readiness({
      fireDrill: { passed: true, passedChecks: 6, totalChecks: 6 },
    }), connection(), NOW);

    for (const manifest of [missingReadiness, missingAccount, missingFireDrill]) {
      expect(manifest.eligibleForHumanArming).toBe(false);
      expect(manifest.blockers.some((blocker) => blocker.includes("falta una marca temporal válida"))).toBe(true);
    }
  });

  it("Pruebas obligatorias #5: blocks an invalid (non-numeric) timestamp", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: "not-a-timestamp",
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.freshness.account.timestamp).toBeNull();
    expect(manifest.blockers.some((blocker) => blocker.includes("auditoría de cuenta") && blocker.includes("falta una marca temporal válida"))).toBe(true);
  });

  it("Pruebas obligatorias #5: blocks a future timestamp for any of the three evidences, with zero tolerance", async () => {
    const futureReadiness = await buildPilotOneShotManifest(readiness({ generatedAt: NOW + 1 }), connection(), NOW);
    const futureAccount = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW + 1,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);
    const futureFireDrill = await buildPilotOneShotManifest(readiness({
      fireDrill: { passed: true, passedChecks: 6, totalChecks: 6, generatedAt: NOW + 1 },
    }), connection(), NOW);

    for (const manifest of [futureReadiness, futureAccount, futureFireDrill]) {
      expect(manifest.eligibleForHumanArming).toBe(false);
      expect(manifest.blockers.some((blocker) => blocker.includes("está en el futuro"))).toBe(true);
    }
  });

  it("Pruebas obligatorias #6: expiresAt never exceeds the deadline of the nearest evidence, even when the certificate lasts longer", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      generatedAt: NOW - 29_000, // vence en NOW + 1_000: el más próximo de todos
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 1_000,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
      fireDrill: { passed: true, passedChecks: 6, totalChecks: 6, generatedAt: NOW - 1_000 },
      preflightCertificate: { status: "valid", certificateId: "certificate-1", expiresAt: NOW + 10 * 60_000 },
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(true);
    expect(manifest.expiresAt).toBe(NOW + 1_000);
  });

  it("Pruebas obligatorias #6: never promises future validity for evidence that is already invalid", async () => {
    const manifest = await buildPilotOneShotManifest(readiness({
      generatedAt: NOW + 5_000, // futuro: no se le puede prometer ningún vencimiento futuro
    }), connection(), NOW);

    expect(manifest.eligibleForHumanArming).toBe(false);
    expect(manifest.expiresAt).toBeLessThanOrEqual(NOW);
  });

  it("changes the seal when only freshness/age changes, even if every other field stays identical", async () => {
    const fresh = await buildPilotOneShotManifest(readiness(), connection(), NOW);
    const staleAccount = await buildPilotOneShotManifest(readiness({
      accountCleanliness: {
        schemaVersion: "kraken-account-cleanliness-v1",
        accountCleanForBaseline: true,
        checkedAt: NOW - 20_000,
        eurBalance: 10,
        nonEurAssetCount: 0,
        openOrderCount: 0,
      },
    }), connection(), NOW);

    expect(staleAccount.payloadHashSha256).not.toBe(fresh.payloadHashSha256);
  });

  it("Pruebas obligatorias #7: does not change /api/pilot/submit, /api/live*, cron, strategy or secrets", () => {
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const scheduled = core.slice(core.indexOf("async scheduled"));

    expect(core).toContain('url.pathname === "/api/pilot/submit"');
    expect(core).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(core).toContain('url.pathname.startsWith("/api/live")');
    expect(core).toContain("LIVE_TRADING_HARD_DISABLED");
    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
    expect(scheduled).not.toContain("buildPilotOneShotManifest");

    const manifestSource = readFileSync(join(ROOT, "src/pilot-one-shot-manifest.ts"), "utf8");
    expect(manifestSource).toContain("submitCapable: false");
    expect(manifestSource).toContain("realOrderCreated: false");
    expect(manifestSource).toContain("liveTrading: false");
    expect(manifestSource).not.toMatch(/LIVE_TRADING_ENABLED\s*[:=]\s*(true|"true")/);
    expect(manifestSource).not.toContain("KRAKEN_API_KEY");
    expect(manifestSource).not.toContain("KRAKEN_API_SECRET");
  });
});
