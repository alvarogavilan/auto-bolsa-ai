import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalKrakenFeePair,
  fetchKrakenEffectiveFees,
} from "../src/kraken-fees";

const ROOT = process.cwd();
const originalFetch = globalThis.fetch;
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("effective fee pair and validation lease", () => {
  it("matches Kraken aliases but not another trading pair", () => {
    expect(canonicalKrakenFeePair("XXBTZEUR")).toBe("XBTEUR");
    expect(canonicalKrakenFeePair("XBT/EUR")).toBe("XBTEUR");
    expect(canonicalKrakenFeePair("XBTEUR")).toBe("XBTEUR");
    expect(canonicalKrakenFeePair("XETHZEUR")).toBe("ETHEUR");
    expect(canonicalKrakenFeePair("ETHEUR")).not.toBe(canonicalKrakenFeePair("XBTEUR"));
  });

  it("never falls back to the first fee entry when the configured pair is absent", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      error: [],
      result: {
        fees: { XETHZEUR: { fee: "0.8000" } },
        fees_maker: { XETHZEUR: { fee: "0.4000" } },
      },
    })) as typeof fetch;

    const audit = await fetchKrakenEffectiveFees(
      "api-key",
      "c2VjcmV0",
      "1800000000999",
      "XBTEUR",
      0.004,
      1_800_000_000_000,
    );

    expect(audit.taker).toBeNull();
    expect(audit.maker).toBeNull();
    expect(audit.recommendedPaperFeeEachSideRate).toBeNull();
    expect(audit.paperFeeMatchesCurrentTaker).toBeNull();
  });

  it("holds the global private lease across Balance and OpenOrders", () => {
    const cleanliness = read("src/pilot-account-cleanliness.ts");
    const acquire = cleanliness.indexOf("const leaseId = await acquireKrakenPrivateLease");
    const gateway = cleanliness.indexOf("new KrakenReadOnlyAccountGateway");
    const audit = cleanliness.indexOf("const audit = await gateway.audit()");
    const release = cleanliness.indexOf("await releaseKrakenPrivateLease");

    expect(acquire).toBeGreaterThan(-1);
    expect(gateway).toBeGreaterThan(acquire);
    expect(audit).toBeGreaterThan(gateway);
    expect(release).toBeGreaterThan(audit);
    expect(cleanliness).toContain("finally");
  });

  it("runs all validation private reads sequentially and parallelizes only public market data", () => {
    const safety = read("src/pilot-validation-safety.ts");
    const proposal = read("src/pilot-validation-proposal.ts");

    const connection = safety.indexOf('stub.fetch("https://bot/kraken/connection")');
    const permissions = safety.indexOf('stub.fetch("https://bot/kraken/permissions")');
    expect(connection).toBeGreaterThan(-1);
    expect(permissions).toBeGreaterThan(connection);
    expect(safety).not.toContain("Promise.all");

    const validationSafety = proposal.indexOf("await fetchPilotValidationSafety(env)");
    const accountAudit = proposal.indexOf("await auditPilotAccountCleanliness(env, true)");
    const publicParallel = proposal.indexOf("await Promise.all([");
    expect(validationSafety).toBeGreaterThan(-1);
    expect(accountAudit).toBeGreaterThan(validationSafety);
    expect(publicParallel).toBeGreaterThan(accountAudit);
  });
});
