import { describe, expect, it } from "vitest";
import {
  PersistedAtomicLivePreflightCertificateStore,
  livePreflightCertificateStorageKey,
  type LivePreflightCertificatePersistence,
  type LocalAtomicRunner,
} from "../src/live-preflight-certificate-store";
import {
  createLivePreflightCertificate,
  type LivePreflightCertificate,
} from "../src/live-preflight-certificate";
import type { LiveOrderRequest } from "../src/live-executor";

const NOW = 1_800_000_000_000;
const CL_ORD_ID = "00000000-0000-4000-8000-000000000001";

const REQUEST: LiveOrderRequest = {
  idempotencyKey: "store-test",
  pair: "XBTEUR",
  side: "buy",
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

async function certificate(): Promise<LivePreflightCertificate> {
  return createLivePreflightCertificate(
    {
      pair: REQUEST.pair,
      side: REQUEST.side,
      volumeBase: REQUEST.volumeBase,
      limitPrice: REQUEST.limitPrice,
      notionalEur: REQUEST.notionalEur,
    },
    {
      status: "validated",
      checkedAt: NOW,
      contactedKraken: true,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      clOrdId: CL_ORD_ID,
      blockers: [],
      message: "validated",
      description: null,
      anomaly: null,
    },
    { certificateIdFactory: () => "cert-store-1" },
  );
}

class MemoryPersistence implements LivePreflightCertificatePersistence {
  readonly values = new Map<string, LivePreflightCertificate>();
  writes = 0;
  failWrites = false;

  async get(key: string): Promise<LivePreflightCertificate | null> {
    const value = this.values.get(key);
    return value ? structuredClone(value) : null;
  }

  async put(key: string, value: LivePreflightCertificate): Promise<void> {
    if (this.failWrites) throw new Error("persistent write failed");
    this.writes += 1;
    this.values.set(key, structuredClone(value));
  }
}

/** Cola mínima que reproduce una sección crítica local serializada. */
class SerialAtomicRunner implements LocalAtomicRunner {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

describe("persisted atomic preflight certificate store", () => {
  it("builds one stable storage key per clOrdId", () => {
    expect(livePreflightCertificateStorageKey(CL_ORD_ID)).toBe(
      `live-preflight-certificate-v1:${CL_ORD_ID}`,
    );
    expect(() => livePreflightCertificateStorageKey("   ")).toThrow(/clOrdId vacío/);
  });

  it("persists consumedAt before returning authorization", async () => {
    const persistence = new MemoryPersistence();
    const key = livePreflightCertificateStorageKey(CL_ORD_ID);
    persistence.values.set(key, await certificate());
    const store = new PersistedAtomicLivePreflightCertificateStore(
      persistence,
      new SerialAtomicRunner(),
    );

    const result = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_000);

    expect(result.ok).toBe(true);
    expect(persistence.writes).toBe(1);
    expect(persistence.values.get(key)?.consumedAt).toBe(NOW + 1_000);
    if (result.ok) expect(result.certificate.consumedAt).toBe(NOW + 1_000);
  });

  it("allows exactly one winner under concurrent consumption", async () => {
    const persistence = new MemoryPersistence();
    const key = livePreflightCertificateStorageKey(CL_ORD_ID);
    persistence.values.set(key, await certificate());
    const store = new PersistedAtomicLivePreflightCertificateStore(
      persistence,
      new SerialAtomicRunner(),
    );

    const results = await Promise.all([
      store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_000),
      store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_001),
      store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_002),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(2);
    expect(persistence.writes).toBe(1);
    expect(persistence.values.get(key)?.consumedAt).toBe(NOW + 1_000);
  });

  it("fails closed for missing, expired, reused or mismatched certificates", async () => {
    const persistence = new MemoryPersistence();
    const store = new PersistedAtomicLivePreflightCertificateStore(
      persistence,
      new SerialAtomicRunner(),
    );

    const missing = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_000);
    expect(missing.ok).toBe(false);

    const key = livePreflightCertificateStorageKey(CL_ORD_ID);
    persistence.values.set(key, await certificate());
    const expired = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 2 * 60_000);
    expect(expired.ok).toBe(false);

    persistence.values.set(key, await certificate());
    const mismatch = await store.consumeForOrder(
      CL_ORD_ID,
      { ...REQUEST, limitPrice: 50_001, notionalEur: 5.0001 },
      NOW + 1_000,
    );
    expect(mismatch.ok).toBe(false);

    persistence.values.set(key, await certificate());
    const first = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_000);
    const reused = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_001);
    expect(first.ok).toBe(true);
    expect(reused.ok).toBe(false);
  });

  it("does not return authorization when persistence fails", async () => {
    const persistence = new MemoryPersistence();
    const key = livePreflightCertificateStorageKey(CL_ORD_ID);
    const original = await certificate();
    persistence.values.set(key, original);
    persistence.failWrites = true;
    const store = new PersistedAtomicLivePreflightCertificateStore(
      persistence,
      new SerialAtomicRunner(),
    );

    const result = await store.consumeForOrder(CL_ORD_ID, REQUEST, NOW + 1_000);

    expect(result.ok).toBe(false);
    expect(persistence.values.get(key)?.consumedAt).toBeNull();
    expect(persistence.writes).toBe(0);
  });
});
