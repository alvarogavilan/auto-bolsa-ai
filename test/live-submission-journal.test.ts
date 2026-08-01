import { describe, expect, it } from "vitest";
import type { LiveOrderRequest } from "../src/live-executor";
import {
  PersistedLiveSubmissionJournal,
  liveSubmissionJournalStorageKey,
  type LiveSubmissionJournalCriticalSection,
  type LiveSubmissionJournalEntry,
  type LiveSubmissionJournalPersistence,
} from "../src/live-submission-journal";
import type { LiveTransportOrderRequest } from "../src/live-transport";

const NOW = 1_800_000_000_000;

function sourceRequest(overrides: Partial<LiveOrderRequest> = {}): LiveOrderRequest {
  return {
    idempotencyKey: "journal-signal",
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
    ...overrides,
  };
}

function transportRequest(overrides: Partial<LiveTransportOrderRequest> = {}): LiveTransportOrderRequest {
  return {
    clOrdId: "11111111-1111-4111-8111-111111111111",
    pair: "XBTEUR",
    side: "buy",
    volumeBase: "0.0001",
    limitPrice: "50000",
    ...overrides,
  };
}

class MemoryPersistence implements LiveSubmissionJournalPersistence {
  values = new Map<string, LiveSubmissionJournalEntry>();
  writes = 0;

  constructor(private readonly failWrite = false) {}

  async get(key: string): Promise<LiveSubmissionJournalEntry | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: LiveSubmissionJournalEntry): Promise<void> {
    if (this.failWrite) throw new Error("journal storage unavailable");
    this.writes += 1;
    this.values.set(key, structuredClone(value));
  }
}

class SerialCriticalSection implements LiveSubmissionJournalCriticalSection {
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

function journal(persistence = new MemoryPersistence()) {
  return {
    persistence,
    journal: new PersistedLiveSubmissionJournal(persistence, new SerialCriticalSection()),
  };
}

describe("LIVE submission write-ahead journal", () => {
  it("persists an exact intent before any transport outcome exists", async () => {
    const setup = journal();
    const result = await setup.journal.persistIntent(
      transportRequest().clOrdId,
      "certificate-1",
      transportRequest(),
      sourceRequest(),
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.entry?.phase).toBe("intent_persisted");
    expect(result.entry?.transportOutcome).toBeNull();
    expect(result.entry?.certificateId).toBe("certificate-1");
    expect(result.entry?.orderFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(setup.persistence.writes).toBe(1);
  });

  it("treats a restart after intent persistence as reconcile-only, never resend", async () => {
    const setup = journal();
    const clOrdId = transportRequest().clOrdId;
    await setup.journal.persistIntent(clOrdId, "certificate-1", transportRequest(), sourceRequest(), NOW);

    // Simula otra instancia creada tras un reinicio con el mismo storage.
    const restarted = new PersistedLiveSubmissionJournal(setup.persistence, new SerialCriticalSection());
    const decision = await restarted.recoveryDecision(clOrdId);

    expect(decision.action).toBe("reconcile_only");
    expect(decision.blockers.join(" ")).toMatch(/ambiguo/i);
  });

  it("allows exactly one winner when several calls persist the same intent concurrently", async () => {
    const setup = journal();
    const clOrdId = transportRequest().clOrdId;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => setup.journal.persistIntent(
        clOrdId,
        "certificate-1",
        transportRequest(),
        sourceRequest(),
        NOW,
      )),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(4);
    expect(setup.persistence.writes).toBe(1);
  });

  it("never overwrites an existing clOrdId with a different economic payload", async () => {
    const setup = journal();
    const clOrdId = transportRequest().clOrdId;
    const first = await setup.journal.persistIntent(clOrdId, "certificate-1", transportRequest(), sourceRequest(), NOW);
    expect(first.ok).toBe(true);

    const changedTransport = transportRequest({ limitPrice: "50001" });
    const changedSource = sourceRequest({ limitPrice: 50_001, notionalEur: 5.0001 });
    const second = await setup.journal.persistIntent(
      clOrdId,
      "certificate-1",
      changedTransport,
      changedSource,
      NOW + 1,
    );

    expect(second.ok).toBe(false);
    expect(second.blockers.join(" ")).toMatch(/payload diferente/i);
    const stored = await setup.persistence.get(liveSubmissionJournalStorageKey(clOrdId));
    expect(stored?.order.limitPrice).toBe("50000");
    expect(setup.persistence.writes).toBe(1);
  });

  it("records an accepted or ambiguous transport outcome without authorizing another send", async () => {
    const setup = journal();
    const clOrdId = transportRequest().clOrdId;
    await setup.journal.persistIntent(clOrdId, "certificate-1", transportRequest(), sourceRequest(), NOW);

    const updated = await setup.journal.recordTransportOutcome(
      clOrdId,
      { kind: "unknown", exchangeOrderId: null, raw: { timeout: true } },
      NOW + 1_000,
    );
    expect(updated.phase).toBe("transport_outcome_recorded");
    expect(updated.transportOutcome?.kind).toBe("unknown");

    const decision = await setup.journal.recoveryDecision(clOrdId);
    expect(decision.action).toBe("reconcile_only");
    expect(decision.blockers.join(" ")).toMatch(/orden, fills y balances/i);

    const repeated = await setup.journal.persistIntent(
      clOrdId,
      "certificate-1",
      transportRequest(),
      sourceRequest(),
      NOW + 2_000,
    );
    expect(repeated.ok).toBe(false);
  });

  it("becomes terminal only after explicit verified reconciliation", async () => {
    const setup = journal();
    const clOrdId = transportRequest().clOrdId;
    await setup.journal.persistIntent(clOrdId, "certificate-1", transportRequest(), sourceRequest(), NOW);
    await setup.journal.recordTransportOutcome(
      clOrdId,
      { kind: "accepted", exchangeOrderId: "O-1", raw: {} },
      NOW + 1_000,
    );
    const reconciled = await setup.journal.markReconciled(clOrdId, NOW + 2_000);

    expect(reconciled.phase).toBe("reconciled");
    expect(reconciled.reconciledAt).toBe(NOW + 2_000);
    expect((await setup.journal.recoveryDecision(clOrdId)).action).toBe("none");
  });

  it("fails closed when the write-ahead record cannot be persisted", async () => {
    const persistence = new MemoryPersistence(true);
    const service = new PersistedLiveSubmissionJournal(persistence, new SerialCriticalSection());

    await expect(service.persistIntent(
      transportRequest().clOrdId,
      "certificate-1",
      transportRequest(),
      sourceRequest(),
      NOW,
    )).rejects.toThrow(/journal storage unavailable/);

    expect(persistence.writes).toBe(0);
  });
});
