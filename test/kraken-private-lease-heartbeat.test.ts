import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KRAKEN_PRIVATE_LEASE_HEARTBEAT_MS,
  KRAKEN_PRIVATE_LEASE_RENEW_PATH,
  KRAKEN_PRIVATE_LEASE_TTL_MS,
  renewKrakenPrivateLease,
  startKrakenPrivateLeaseHeartbeat,
} from "../src/kraken-private-lease";
import type { Env } from "../src/types";

const ROOT = process.cwd();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function environment(handler: (request: Request) => Promise<Response>): Env {
  const stub = { fetch: vi.fn(handler) };
  const namespace = {
    idFromName: vi.fn(() => ({}) as DurableObjectId),
    get: vi.fn(() => stub as unknown as DurableObjectStub),
  };
  return { BOT_STATE: namespace as unknown as DurableObjectNamespace } as Env;
}

describe("Kraken private lease heartbeat", () => {
  it("renews periodically and stops without leaving another timer", async () => {
    vi.useFakeTimers();
    const requests: Request[] = [];
    const env = environment(async (request) => {
      requests.push(request);
      return Response.json({ renewed: true, leaseId: "lease-1", expiresAt: Date.now() + 120_000 });
    });

    const heartbeat = startKrakenPrivateLeaseHeartbeat(env, "lease-1", 1_000);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => new URL(request.url).pathname === KRAKEN_PRIVATE_LEASE_RENEW_PATH)).toBe(true);
    expect(heartbeat.failure()).toBeNull();

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requests).toHaveLength(3);
  });

  it("records a renewal failure and never schedules another renewal", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const env = environment(async () => {
      calls += 1;
      return Response.json({ renewed: false }, { status: 409 });
    });

    const heartbeat = startKrakenPrivateLeaseHeartbeat(env, "lost-lease", 500);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toBe(1);
    expect(heartbeat.failure()?.message).toMatch(/renovar/i);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(1);
    heartbeat.stop();
  });

  it("sends only the lease id to the internal renewal endpoint", async () => {
    let captured: Request | null = null;
    const env = environment(async (request) => {
      captured = request;
      return Response.json({ renewed: true, leaseId: "lease-2", expiresAt: Date.now() + 120_000 });
    });

    await renewKrakenPrivateLease(env, "lease-2");
    expect(captured).not.toBeNull();
    expect(new URL((captured as unknown as Request).url).pathname).toBe(KRAKEN_PRIVATE_LEASE_RENEW_PATH);
    expect(await (captured as unknown as Request).clone().json()).toEqual({ leaseId: "lease-2" });
  });

  it("keeps heartbeat comfortably below the persisted lease TTL", () => {
    expect(KRAKEN_PRIVATE_LEASE_HEARTBEAT_MS).toBeLessThanOrEqual(KRAKEN_PRIVATE_LEASE_TTL_MS / 4);
    expect(KRAKEN_PRIVATE_LEASE_TTL_MS).toBe(120_000);
  });

  it("renews atomically, rejects expired leases and marks renewal failure for reconciliation", () => {
    const bot = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");
    const coordinated = readFileSync(join(ROOT, "src/live-executor-state-coordinated.ts"), "utf8");

    expect(bot).toContain("private async renewPrivateLease");
    expect(bot).toContain("active.expiresAt <= now");
    expect(bot).toContain("blockConcurrencyWhile");
    expect(bot).toContain("KRAKEN_PRIVATE_LEASE_RENEW_PATH");
    expect(coordinated).toContain("startKrakenPrivateLeaseHeartbeat");
    expect(coordinated).toContain("KRAKEN_PRIVATE_LEASE_RENEWAL_FAILED");
    expect(coordinated).toContain("reconciliationRequired: true");
    expect(coordinated.indexOf("heartbeat.stop()" )).toBeLessThan(coordinated.indexOf("releaseKrakenPrivateLease"));
  });
});
