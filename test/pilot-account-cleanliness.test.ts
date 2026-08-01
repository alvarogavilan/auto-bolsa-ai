import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KrakenReadOnlyAccountGateway } from "../src/live-order-preflight";
import { applyAccountCleanlinessToReadiness } from "../src/pilot-account-cleanliness";
import { fireDrillPilotDashboard } from "../src/pilot-dashboard-fire-drill";

const ROOT = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockKraken(balance: Record<string, string>, open: Record<string, unknown>) {
  const requests: Request[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith("/Balance")) return Response.json({ error: [], result: balance });
    if (request.url.endsWith("/OpenOrders")) return Response.json({ error: [], result: { open } });
    throw new Error(`Unexpected Kraken URL: ${request.url}`);
  }) as typeof fetch;
  return requests;
}

describe("Kraken account cleanliness", () => {
  it("accepts an EUR-only account without open orders", async () => {
    const requests = mockKraken({ ZEUR: "10.0000", XXBT: "0.0000" }, {});
    const nonces: string[] = [];
    const gateway = new KrakenReadOnlyAccountGateway(
      "api-key",
      "c2VjcmV0",
      async () => {
        const nonce = String(1_800_000_000_000 + nonces.length + 1);
        nonces.push(nonce);
        return nonce;
      },
    );

    const audit = await gateway.audit(1_800_000_000_000);
    expect(audit.eurBalance).toBe(10);
    expect(audit.nonZeroAssetCount).toBe(1);
    expect(audit.nonEurAssetCount).toBe(0);
    expect(audit.openOrderCount).toBe(0);
    expect(audit.accountCleanForBaseline).toBe(true);
    expect(audit.blockers).toEqual([]);
    expect(audit.nonceRequests).toBe(2);
    expect(audit.networkCallsToKraken).toBe(2);
    expect(audit.readOnly).toBe(true);
    expect(audit.realOrderCreated).toBe(false);
    expect(audit.liveTrading).toBe(false);
    expect(nonces).toHaveLength(2);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/0/private/Balance",
      "/0/private/OpenOrders",
    ]);
  });

  it("blocks both prior inventory and an existing open order", async () => {
    mockKraken(
      { ZEUR: "8.0000", XETH: "0.0500" },
      { ORDER1: { status: "open", vol: "0.01", vol_exec: "0", opentm: "1800000000", descr: {} } },
    );
    let nonce = 1_800_000_000_100;
    const gateway = new KrakenReadOnlyAccountGateway("api-key", "c2VjcmV0", async () => String(++nonce));
    const audit = await gateway.audit();
    expect(audit.nonEurAssetCount).toBe(1);
    expect(audit.openOrderCount).toBe(1);
    expect(audit.accountCleanForBaseline).toBe(false);
    expect(audit.blockers).toEqual([
      "La cuenta contiene activos no EUR antes del baseline",
      "La cuenta contiene órdenes abiertas antes del baseline",
    ]);
  });

  it("requests nonces and private reads strictly in sequence", async () => {
    const events: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      events.push(path.endsWith("Balance") ? "fetch-balance" : "fetch-open-orders");
      return path.endsWith("Balance")
        ? Response.json({ error: [], result: { ZEUR: "0" } })
        : Response.json({ error: [], result: { open: {} } });
    }) as typeof fetch;
    let nonceIndex = 0;
    const gateway = new KrakenReadOnlyAccountGateway(
      "api-key",
      "c2VjcmV0",
      async () => {
        nonceIndex += 1;
        events.push(`nonce-${nonceIndex}`);
        return String(1_800_000_001_000 + nonceIndex);
      },
    );
    await gateway.audit();
    expect(events).toEqual(["nonce-1", "fetch-balance", "nonce-2", "fetch-open-orders"]);
  });

  it("never calls an order-creation or mutation endpoint", async () => {
    const requests = mockKraken({ ZEUR: "10" }, {});
    let nonce = 1_800_000_002_000;
    await new KrakenReadOnlyAccountGateway("api-key", "c2VjcmV0", async () => String(++nonce)).audit();
    const serialized = await Promise.all(requests.map(async (request) => `${request.url} ${await request.clone().text()}`));
    expect(serialized.join("\n")).not.toContain("AddOrder");
    expect(serialized.join("\n")).not.toContain("CancelOrder");
    expect(serialized.join("\n")).not.toContain("validate=true");
  });

  it("can only preserve or reduce readiness eligibility", () => {
    const clean = {
      schemaVersion: "kraken-account-cleanliness-v1" as const,
      checkedAt: 1,
      eurBalance: 10,
      nonZeroAssetCount: 1,
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
    const dirty = {
      ...clean,
      nonZeroAssetCount: 2,
      nonEurAssetCount: 1,
      accountCleanForBaseline: false,
      blockers: ["La cuenta contiene activos no EUR antes del baseline"],
    };

    const eligible = applyAccountCleanlinessToReadiness({ blockers: [], passedChecks: [], infrastructureEligibleForManualReview: true }, clean, null);
    const previouslyBlocked = applyAccountCleanlinessToReadiness({ blockers: ["PAPER pendiente"], passedChecks: [], infrastructureEligibleForManualReview: false }, clean, null);
    const newlyBlocked = applyAccountCleanlinessToReadiness({ blockers: [], passedChecks: [], infrastructureEligibleForManualReview: true }, dirty, null);

    expect(eligible.infrastructureEligibleForManualReview).toBe(true);
    expect(previouslyBlocked.infrastructureEligibleForManualReview).toBe(false);
    expect(newlyBlocked.infrastructureEligibleForManualReview).toBe(false);
    expect(newlyBlocked.blockers).toContain("La cuenta contiene activos no EUR antes del baseline");
  });

  it("shows the audit in the iPhone console without exposing assets or secrets", async () => {
    const html = await (await fireDrillPilotDashboard()).text();
    expect(html).toContain("Limpieza de la cuenta Kraken");
    expect(html).toContain("Activos no EUR");
    expect(html).toContain("Órdenes abiertas");
    expect(html).toContain("/api/pilot/audit-account");
    expect(html).toContain("renderPilotAccountCleanliness(data.accountCleanliness)");
    expect(html).not.toContain("KRAKEN_API_SECRET");
    expect(html).not.toContain("API-Sign");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("acquires the global private lease before the first nonce and releases it in finally", () => {
    const audit = readFileSync(join(ROOT, "src/pilot-account-cleanliness.ts"), "utf8");
    const cacheLookup = audit.indexOf("const cached = await cache.match(key)");
    const acquire = audit.indexOf("const leaseId = await acquireKrakenPrivateLease");
    const gateway = audit.indexOf("new KrakenReadOnlyAccountGateway");
    const release = audit.indexOf("releaseKrakenPrivateLease(env, leaseId)");

    expect(cacheLookup).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(cacheLookup);
    expect(gateway).toBeGreaterThan(acquire);
    expect(release).toBeGreaterThan(gateway);
    expect(audit).toContain("} finally {");
    expect(audit).toContain("account-cleanliness:${crypto.randomUUID()}");
  });

  it("keeps private Kraken calls inside authorized and globally serialized files", () => {
    const gateway = readFileSync(join(ROOT, "src/live-order-preflight.ts"), "utf8");
    const audit = readFileSync(join(ROOT, "src/pilot-account-cleanliness.ts"), "utf8");
    const adapter = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");

    expect(gateway).toContain("class KrakenReadOnlyAccountGateway");
    expect(gateway).toContain("const balanceNonce = await this.nextNonce()");
    expect(gateway).toContain("const openOrdersNonce = await this.nextNonce()");
    expect(gateway).not.toContain("computeNextNonce");
    expect(audit).toContain("acquireKrakenPrivateLease");
    expect(audit).toContain("releaseKrakenPrivateLease");
    expect(adapter).toContain('url.pathname === "/api/pilot/audit-account"');
    expect(adapter).toContain("if (!isAuthorized(request, env))");
  });
});
