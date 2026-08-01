import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("account cleanliness private lease", () => {
  it("uses cache before lease and acquires before the first private gateway", () => {
    const source = readFileSync(join(ROOT, "src/pilot-account-cleanliness.ts"), "utf8");
    const cache = source.indexOf("const cached = await cache.match(key)");
    const acquire = source.indexOf("const leaseId = await acquireKrakenPrivateLease");
    const gateway = source.indexOf("new KrakenReadOnlyAccountGateway");
    const release = source.indexOf("releaseKrakenPrivateLease(env, leaseId)");

    expect(cache).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(cache);
    expect(gateway).toBeGreaterThan(acquire);
    expect(release).toBeGreaterThan(gateway);
  });

  it("releases the lease in finally and keeps the audit read-only", () => {
    const source = readFileSync(join(ROOT, "src/pilot-account-cleanliness.ts"), "utf8");
    expect(source).toContain("} finally {");
    expect(source).toContain("releaseKrakenPrivateLease(env, leaseId).catch(() => undefined)");
    expect(source).toContain("const audit = await gateway.audit()");
    expect(source).not.toContain("AddOrder");
    expect(source).not.toContain("CancelOrder");
    expect(source).not.toContain("LIVE_TRADING_ENABLED");
  });

  it("shares the persisted lease used by BotState and the coordinated executor", () => {
    const audit = readFileSync(join(ROOT, "src/pilot-account-cleanliness.ts"), "utf8");
    const bot = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");
    const live = readFileSync(join(ROOT, "src/live-executor-state-coordinated.ts"), "utf8");

    expect(audit).toContain('from "./kraken-private-lease"');
    expect(bot).toContain('const KRAKEN_PRIVATE_LEASE_KEY = "kraken-private-lease-v1"');
    expect(live).toContain("acquireKrakenPrivateLease");
  });

  it("does not add the audit to cron", () => {
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const scheduled = core.slice(core.indexOf("async scheduled"));
    expect(scheduled).not.toContain("auditPilotAccountCleanliness");
    expect(scheduled).not.toContain("/api/pilot");
  });
});
