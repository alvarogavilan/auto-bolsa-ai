import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KrakenLiveOrderTransport } from "../src/live-transport";
import { isLiveExecutorPrivatePath } from "../src/kraken-private-lease";

const originalFetch = globalThis.fetch;
const ROOT = process.cwd();

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function privateResponse(pathname: string): Response {
  if (pathname.endsWith("/OpenOrders")) return Response.json({ error: [], result: { open: {} } });
  if (pathname.endsWith("/ClosedOrders")) return Response.json({ error: [], result: { closed: {} } });
  if (pathname.endsWith("/Balance")) return Response.json({ error: [], result: { ZEUR: "10" } });
  throw new Error(`Unexpected private endpoint ${pathname}`);
}

describe("Kraken private call serialization", () => {
  it("executes simultaneous open, closed and balance calls with concurrency exactly one", async () => {
    let active = 0;
    let maximumActive = 0;
    const paths: string[] = [];
    const nonces: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      paths.push(new URL(request.url).pathname);
      nonces.push(new URLSearchParams(await request.clone().text()).get("nonce") ?? "");
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return privateResponse(new URL(request.url).pathname);
    }) as typeof fetch;

    let sequence = 1_800_000_000_000n;
    const transport = new KrakenLiveOrderTransport("api-key", "c2VjcmV0", async () => (++sequence).toString());
    const [open, closed, balances] = await Promise.all([
      transport.listOpenOrders(),
      transport.listClosedOrders(),
      transport.fetchBalances(),
    ]);

    expect(open).toEqual([]);
    expect(closed).toEqual([]);
    expect(balances).toEqual({ ZEUR: "10" });
    expect(maximumActive).toBe(1);
    expect(paths).toEqual(["/0/private/OpenOrders", "/0/private/ClosedOrders", "/0/private/Balance"]);
    expect(nonces.map(BigInt)).toEqual([1_800_000_000_001n, 1_800_000_000_002n, 1_800_000_000_003n]);
  });

  it("findByClOrdId obtains open and closed orders sequentially without nested queue deadlock", async () => {
    let active = 0;
    let maximumActive = 0;
    const paths: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      paths.push(pathname);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      if (pathname.endsWith("/OpenOrders")) return Response.json({ error: [], result: { open: {} } });
      return Response.json({ error: [], result: { closed: { TX1: {
        status: "closed", cl_ord_id: "wanted-cl-ord-id", vol: "0.0001", vol_exec: "0.0001", price: "50000",
      } } } });
    }) as typeof fetch;

    let sequence = 1_800_000_100_000n;
    const transport = new KrakenLiveOrderTransport("api-key", "c2VjcmV0", async () => (++sequence).toString());
    const found = await transport.findByClOrdId("wanted-cl-ord-id");
    expect(found?.exchangeOrderId).toBe("TX1");
    expect(maximumActive).toBe(1);
    expect(paths).toEqual(["/0/private/OpenOrders", "/0/private/ClosedOrders"]);
  });

  it("protects every executor route that can reach a private Kraken endpoint", () => {
    for (const path of ["/preflight", "/submit", "/reconcile", "/retry", "/emergency-cancel-all"]) {
      expect(isLiveExecutorPrivatePath(path)).toBe(true);
    }
    expect(isLiveExecutorPrivatePath("/status")).toBe(false);
    expect(isLiveExecutorPrivatePath("/prepare-validation")).toBe(false);
  });

  it("uses one persisted BotState lease for admin and LIVE private operations", () => {
    const botState = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");
    const coordinated = readFileSync(join(ROOT, "src/live-executor-state-coordinated.ts"), "utf8");
    const entry = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
    expect(botState).toContain('const KRAKEN_PRIVATE_LEASE_KEY = "kraken-private-lease-v1"');
    expect(botState).toContain("blockConcurrencyWhile");
    expect(botState).toContain("withOwnPrivateLease");
    expect(coordinated).toContain("acquireKrakenPrivateLease");
    expect(coordinated).toContain("releaseKrakenPrivateLease");
    expect(entry).toContain("CoordinatedLiveExecutorState as LiveExecutorState");
  });

  it("does not arm LIVE or add private execution to cron", () => {
    const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
    const entry = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(wrangler).not.toContain("LIVE_TRADING_ENABLED");
    expect(entry).not.toContain("/api/pilot/submit");
    expect(entry).not.toContain("/api/live");
    const scheduled = core.slice(core.indexOf("async scheduled"));
    expect(scheduled).not.toContain("LIVE_EXECUTOR");
    expect(scheduled).not.toContain("/api/pilot");
  });
});
