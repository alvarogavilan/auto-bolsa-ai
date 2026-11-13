import { afterEach, describe, expect, it, vi } from "vitest";
import { runSignalAlerts } from "../src/signal-alerts-runner";
import {
  claimSignalAlert,
  commitSignalAlert,
  emptySignalAlertState,
  releaseSignalAlert,
  type SignalAlertState,
} from "../src/signal-alerts-store";

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function xauStatus(open: Record<string, unknown> | null, closed: Record<string, unknown>[] = []): unknown {
  return {
    metrics: { decisionCycles: 900, approved: 40 },
    cycles: [],
    positionBook: {
      open,
      closed,
      metrics: { closed: 12, winners: 8, realizedPnlEur: 5 },
      treasury: { initialCapitalEur: 100, realizedPnlEur: 5, equityEur: 105, equityCurve: [{ equityEur: 100 }, { equityEur: 105 }] },
    },
  };
}

const OPEN = { id: "xau-1-buy", side: "buy", openedAt: NOW - 30_000, entryPrice: 4000, budgetEur: 20, initialStopPrice: 3960, targetPrice: 4100 };

function harness(initialXau: unknown) {
  const store: { state: SignalAlertState; xau: unknown } = { state: emptySignalAlertState(), xau: initialXau };
  const botStub = {
    fetch: async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path === "/xau/status") return Response.json(store.xau);
      if (path === "/signal-alerts/state") return Response.json(store.state);
      if (path === "/signal-alerts/claim") return Response.json({ claimed: claimSignalAlert(store.state, body.key, NOW) });
      if (path === "/signal-alerts/release") { releaseSignalAlert(store.state, body.key); return Response.json({}); }
      if (path === "/signal-alerts/commit") { commitSignalAlert(store.state, body); return Response.json({}); }
      return new Response("nf", { status: 404 });
    },
  };
  const env = {
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_CHAT_ID: "1",
    BOT_STATE: { idFromName: () => "id", get: () => botStub },
    RESEARCH_LAB: { idFromName: () => "id", get: () => ({ fetch: async () => new Response("nf", { status: 404 }) }) },
  } as never;
  return { store, env };
}

function mockNetwork(telegramOk: () => boolean) {
  const sent: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.kraken.com")) {
      return Response.json({ error: [], result: { PAXGEUR: { a: ["3500.00"], b: ["3498.00"], c: ["3499"] } } });
    }
    if (url.includes("api.telegram.org")) {
      if (!telegramOk()) return new Response("down", { status: 502 });
      sent.push(String(JSON.parse(String(init?.body)).text));
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return sent;
}

describe("signal alert runner", () => {
  it("sends BUY exactly once, then SELL exactly once", async () => {
    const { store, env } = harness(xauStatus(OPEN));
    const sent = mockNetwork(() => true);

    await runSignalAlerts(env, { includeCrypto: false, now: NOW });
    await runSignalAlerts(env, { includeCrypto: false, now: NOW + 60_000 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("🟢 COMPRA AHORA");
    expect(store.state.holdings.gold?.entryPriceEur).toBe(3507);

    store.xau = xauStatus(null, [{ ...OPEN, exitPrice: 3960 }]);
    await runSignalAlerts(env, { includeCrypto: false, now: NOW + 120_000 });
    await runSignalAlerts(env, { includeCrypto: false, now: NOW + 180_000 });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("🔴 VENDE AHORA");
    expect(store.state.holdings.gold).toBeUndefined();
  });

  it("retries when Telegram fails instead of losing the alert", async () => {
    const { store, env } = harness(xauStatus(OPEN));
    let up = false;
    const sent = mockNetwork(() => up);
    const first = await runSignalAlerts(env, { includeCrypto: false, now: NOW });
    expect(first.failures).toHaveLength(1);
    expect(store.state.holdings.gold).toBeUndefined();
    up = true;
    await runSignalAlerts(env, { includeCrypto: false, now: NOW + 60_000 });
    expect(sent).toHaveLength(1);
    expect(store.state.holdings.gold).toBeDefined();
  });
});
