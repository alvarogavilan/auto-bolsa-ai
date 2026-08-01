import { describe, expect, it } from "vitest";
import {
  submitOrderWithAtomicPreflightCertificate,
  type AtomicLivePreflightCertificateStore,
  type AtomicLiveSubmissionJournal,
} from "../src/live-certified-submission";
import {
  initializeLiveExecutor,
  observeMarket,
  prepareOrder,
  type LiveExecutorSnapshot,
  type LiveOrderRequest,
} from "../src/live-executor";
import { defaultLiveGuardrailConfig, type LiveGuardrailConfig } from "../src/live-guardrails";
import {
  consumeLivePreflightCertificate,
  createLivePreflightCertificate,
  type LivePreflightCertificate,
} from "../src/live-preflight-certificate";
import type { LiveSubmissionJournalEntry } from "../src/live-submission-journal";
import { FakeLiveOrderTransport, type LiveTransportOrderRequest } from "../src/live-transport";

const NOW = 1_800_000_000_000;

function request(): LiveOrderRequest {
  return {
    idempotencyKey: "certified-signal",
    pair: "XBTEUR",
    side: "buy",
    volumeBase: 0.0001,
    limitPrice: 50_000,
    notionalEur: 5,
  };
}

function config(enabled = true): LiveGuardrailConfig {
  return defaultLiveGuardrailConfig({ liveTradingEnabled: enabled });
}

function preparedState(): { state: LiveExecutorSnapshot; clOrdId: string } {
  const state = initializeLiveExecutor(50, NOW);
  observeMarket(state, 50, NOW);
  const prepared = prepareOrder(state, config(), request(), NOW);
  if (!prepared.ok) throw new Error(`No se pudo preparar la orden: ${prepared.blockers.join("; ")}`);
  return { state, clOrdId: prepared.order.clOrdId };
}

async function certificateFor(clOrdId: string): Promise<LivePreflightCertificate> {
  const orderRequest = request();
  return createLivePreflightCertificate(
    {
      pair: orderRequest.pair,
      side: orderRequest.side,
      volumeBase: orderRequest.volumeBase,
      limitPrice: orderRequest.limitPrice,
      notionalEur: orderRequest.notionalEur,
    },
    {
      status: "validated",
      checkedAt: NOW,
      contactedKraken: true,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      clOrdId,
      blockers: [],
      message: "validated only",
      description: "buy 0.0001 XBTEUR @ 50000",
      anomaly: null,
    },
    { certificateIdFactory: () => "certificate-1" },
  );
}

class MemoryAtomicStore implements AtomicLivePreflightCertificateStore {
  events: string[] = [];

  constructor(
    public certificate: LivePreflightCertificate | null,
    private readonly failWrite = false,
  ) {}

  async consumeForOrder(clOrdId: string, orderRequest: LiveOrderRequest, now: number) {
    this.events.push("consume-start");
    if (!this.certificate) return { ok: false as const, blockers: ["Falta certificado de preflight"] };
    if (this.failWrite) throw new Error("storage unavailable");
    try {
      const consumed = await consumeLivePreflightCertificate(this.certificate, clOrdId, orderRequest, now);
      this.certificate = consumed;
      this.events.push("certificate-persisted-consumed");
      return { ok: true as const, certificate: consumed };
    } catch (error) {
      return {
        ok: false as const,
        blockers: [error instanceof Error ? error.message : "Certificado inválido"],
      };
    }
  }
}

class MemoryJournal implements AtomicLiveSubmissionJournal {
  entry: LiveSubmissionJournalEntry | null = null;

  constructor(
    public events: string[] = [],
    private readonly failIntent = false,
  ) {}

  async persistIntent(
    clOrdId: string,
    certificateId: string,
    orderRequest: LiveTransportOrderRequest,
    sourceRequest: LiveOrderRequest,
    now: number,
  ) {
    this.events.push("journal-intent-start");
    if (this.failIntent) throw new Error("journal unavailable");
    if (this.entry) {
      return {
        ok: false,
        entry: this.entry,
        created: false,
        blockers: ["Ya existe una intención persistida; cualquier recuperación debe reconciliar, nunca reenviar"],
      };
    }
    this.entry = {
      schemaVersion: "live-submission-journal-v1",
      journalId: "journal-1",
      clOrdId,
      certificateId,
      createdAt: now,
      updatedAt: now,
      phase: "intent_persisted",
      order: {
        pair: orderRequest.pair,
        side: orderRequest.side,
        volumeBase: orderRequest.volumeBase,
        limitPrice: orderRequest.limitPrice,
        notionalEur: sourceRequest.notionalEur,
      },
      orderFingerprintSha256: "a".repeat(64),
      transportOutcome: null,
      reconciledAt: null,
    };
    this.events.push("journal-intent-persisted");
    return { ok: true, entry: this.entry, created: true, blockers: [] };
  }

  async recordTransportOutcome(clOrdId: string, ack: Awaited<ReturnType<FakeLiveOrderTransport["createOrder"]>>, now: number) {
    if (!this.entry || this.entry.clOrdId !== clOrdId) throw new Error("journal missing");
    this.entry = {
      ...this.entry,
      phase: "transport_outcome_recorded",
      updatedAt: now,
      transportOutcome: {
        kind: ack.kind,
        exchangeOrderId: ack.exchangeOrderId,
        recordedAt: now,
      },
    };
    this.events.push("journal-outcome-persisted");
    return this.entry;
  }
}

class CountingTransport extends FakeLiveOrderTransport {
  createCalls = 0;

  constructor(private readonly events: string[] = []) {
    super();
  }

  override async createOrder(orderRequest: LiveTransportOrderRequest) {
    this.createCalls += 1;
    this.events.push("transport-create-order");
    return super.createOrder(orderRequest);
  }
}

describe("certified LIVE submission gate", () => {
  it("blocks before certificate consumption when no journal is supplied", async () => {
    const { state, clOrdId } = preparedState();
    const transport = new CountingTransport();
    const store = new MemoryAtomicStore(await certificateFor(clOrdId));

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a blocked submission");
    expect(result.blockers.join(" ")).toMatch(/falta journal/i);
    expect(result.preflightCertificateConsumed).toBe(false);
    expect(store.certificate?.consumedAt).toBeNull();
    expect(transport.createCalls).toBe(0);
  });

  it("blocks before transport when no certificate exists", async () => {
    const { state, clOrdId } = preparedState();
    const transport = new CountingTransport();
    const store = new MemoryAtomicStore(null);
    const journal = new MemoryJournal();

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000, journal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a blocked submission");
    expect(result.preflightCertificateConsumed).toBe(false);
    expect(result.submissionIntentPersisted).toBe(false);
    expect(result.blockers).toContain("Falta certificado de preflight");
    expect(transport.createCalls).toBe(0);
    expect(journal.events).toEqual([]);
  });

  it("persists certificate and intent before the first transport call", async () => {
    const { state, clOrdId } = preparedState();
    const events: string[] = [];
    const store = new MemoryAtomicStore(await certificateFor(clOrdId));
    store.events = events;
    const journal = new MemoryJournal(events);
    const transport = new CountingTransport(events);

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000, journal,
    );

    expect(result.ok).toBe(true);
    expect(result.preflightCertificateConsumed).toBe(true);
    expect(result.submissionIntentPersisted).toBe(true);
    expect(result.certificateId).toBe("certificate-1");
    expect(result.journalId).toBe("journal-1");
    expect(store.certificate?.consumedAt).toBe(NOW + 1_000);
    expect(events).toEqual([
      "consume-start",
      "certificate-persisted-consumed",
      "journal-intent-start",
      "journal-intent-persisted",
      "transport-create-order",
      "journal-outcome-persisted",
    ]);
    expect(transport.createCalls).toBe(1);
  });

  it("never contacts transport if persisting the consumed certificate fails", async () => {
    const { state, clOrdId } = preparedState();
    const store = new MemoryAtomicStore(await certificateFor(clOrdId), true);
    const journal = new MemoryJournal();
    const transport = new CountingTransport();

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000, journal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a storage failure");
    expect(result.preflightCertificateConsumed).toBe(false);
    expect(result.submissionIntentPersisted).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/storage unavailable/);
    expect(transport.createCalls).toBe(0);
    expect(journal.events).toEqual([]);
  });

  it("never contacts transport if journal persistence fails after certificate consumption", async () => {
    const { state, clOrdId } = preparedState();
    const store = new MemoryAtomicStore(await certificateFor(clOrdId));
    const journal = new MemoryJournal([], true);
    const transport = new CountingTransport();

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000, journal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected journal failure");
    expect(result.preflightCertificateConsumed).toBe(true);
    expect(result.submissionIntentPersisted).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/journal unavailable/);
    expect(store.certificate?.consumedAt).toBe(NOW + 1_000);
    expect(transport.createCalls).toBe(0);
  });

  it("consumes and journals once before a timeout and cannot create a duplicate", async () => {
    const { state, clOrdId } = preparedState();
    const store = new MemoryAtomicStore(await certificateFor(clOrdId));
    const journal = new MemoryJournal();
    const transport = new CountingTransport();
    transport.scriptScenario(clOrdId, { kind: "accept-but-report-timeout" });

    const first = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(), store, clOrdId, NOW + 1_000, journal,
    );
    expect(first.ok).toBe(false);
    expect(first.preflightCertificateConsumed).toBe(true);
    expect(first.submissionIntentPersisted).toBe(true);
    expect(state.orders[clOrdId]?.status).toBe("reconciliation_required");
    expect(transport.createCalls).toBe(1);
    expect(journal.entry?.phase).toBe("transport_outcome_recorded");
    expect(journal.entry?.transportOutcome?.kind).toBe("unknown");

    const attemptsAfterTimeout = state.orders[clOrdId]?.attempts;
    for (let index = 0; index < 3; index += 1) {
      const repeated = await submitOrderWithAtomicPreflightCertificate(
        state, transport, config(), store, clOrdId, NOW + 2_000 + index, journal,
      );
      expect(repeated.ok).toBe(false);
      expect(repeated.preflightCertificateConsumed).toBe(false);
    }

    expect(transport.createCalls).toBe(1);
    expect(state.orders[clOrdId]?.attempts).toBe(attemptsAfterTimeout);
    expect(store.certificate?.consumedAt).toBe(NOW + 1_000);
  });

  it("blocks expired or payload-mismatched certificates before journal and transport", async () => {
    const expiredSetup = preparedState();
    const expiredStore = new MemoryAtomicStore(await certificateFor(expiredSetup.clOrdId));
    const expiredJournal = new MemoryJournal();
    const expiredTransport = new CountingTransport();
    const expired = await submitOrderWithAtomicPreflightCertificate(
      expiredSetup.state, expiredTransport, config(), expiredStore, expiredSetup.clOrdId,
      NOW + 2 * 60_000, expiredJournal,
    );
    expect(expired.ok).toBe(false);
    expect(expiredTransport.createCalls).toBe(0);
    expect(expiredJournal.events).toEqual([]);

    const mismatchSetup = preparedState();
    const mismatchStore = new MemoryAtomicStore(await certificateFor(mismatchSetup.clOrdId));
    mismatchSetup.state.orders[mismatchSetup.clOrdId]!.request.limitPrice = 50_001;
    mismatchSetup.state.orders[mismatchSetup.clOrdId]!.request.notionalEur = 5.0001;
    const mismatchJournal = new MemoryJournal();
    const mismatchTransport = new CountingTransport();
    const mismatch = await submitOrderWithAtomicPreflightCertificate(
      mismatchSetup.state, mismatchTransport, config(), mismatchStore, mismatchSetup.clOrdId,
      NOW + 1_000, mismatchJournal,
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatchTransport.createCalls).toBe(0);
    expect(mismatchJournal.events).toEqual([]);
  });

  it("does not consume certificate or journal while LIVE kill switch is disabled", async () => {
    const { state, clOrdId } = preparedState();
    const store = new MemoryAtomicStore(await certificateFor(clOrdId));
    const journal = new MemoryJournal();
    const transport = new CountingTransport();

    const result = await submitOrderWithAtomicPreflightCertificate(
      state, transport, config(false), store, clOrdId, NOW + 1_000, journal,
    );

    expect(result.ok).toBe(false);
    expect(result.preflightCertificateConsumed).toBe(false);
    expect(result.submissionIntentPersisted).toBe(false);
    expect(store.certificate?.consumedAt).toBeNull();
    expect(transport.createCalls).toBe(0);
    expect(store.events).toEqual([]);
    expect(journal.events).toEqual([]);
  });
});
