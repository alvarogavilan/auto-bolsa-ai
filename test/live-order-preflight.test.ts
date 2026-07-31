import { describe, expect, it } from "vitest";
import { KrakenApiError, type KrakenAddOrderRequest } from "../src/kraken";
import {
  forceValidateOnlyOrderRequest,
  runLiveOrderPreflight,
  type LiveOrderPreflightIntent,
  type ValidateOnlyOrderGateway,
} from "../src/live-order-preflight";

const NOW = 1_800_000_000_000;
const CL_ORD_ID = "00000000-0000-4000-8000-000000000001";

const INTENT: LiveOrderPreflightIntent = {
  pair: "XBTEUR",
  side: "buy",
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

const CONSTRAINTS = {
  pairMetadata: {
    XBTEUR: { orderMinBase: 0.00005, lotDecimals: 8, priceDecimals: 1 },
  },
  maxNotionalEur: 5,
  maxNotionalDeviationPct: 0.01,
};

class ScriptedGateway implements ValidateOnlyOrderGateway {
  calls: KrakenAddOrderRequest[] = [];

  constructor(
    private readonly behavior: (request: Readonly<KrakenAddOrderRequest>) => Promise<{
      txid: string[];
      descr: { order?: string };
    }>,
  ) {}

  async validate(request: Readonly<KrakenAddOrderRequest>) {
    this.calls.push({ ...request });
    return this.behavior(request);
  }
}

const OPTIONS = {
  now: NOW,
  clOrdIdFactory: () => CL_ORD_ID,
};

describe("Kraken validate-only LIVE preflight", () => {
  it("forces validate=true even when the incoming request explicitly says false", () => {
    const forced = forceValidateOnlyOrderRequest({
      pair: "XBTEUR",
      type: "buy",
      ordertype: "limit",
      volume: "0.0001",
      price: "50000",
      clOrdId: CL_ORD_ID,
      validate: false,
    });

    expect(forced.validate).toBe(true);
    expect(forced).toEqual({
      pair: "XBTEUR",
      type: "buy",
      ordertype: "limit",
      volume: "0.0001",
      price: "50000",
      clOrdId: CL_ORD_ID,
      validate: true,
    });
  });

  it("returns validated only for a txid-free Kraken response", async () => {
    const gateway = new ScriptedGateway(async () => ({
      txid: [],
      descr: { order: "buy 0.0001 XBTEUR @ limit 50000" },
    }));

    const result = await runLiveOrderPreflight(INTENT, CONSTRAINTS, gateway, OPTIONS);

    expect(result.status).toBe("validated");
    expect(result.matchingEngineSubmission).toBe(false);
    expect(result.realOrderCreated).toBe(false);
    expect(result.anomaly).toBeNull();
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.validate).toBe(true);
    expect(gateway.calls[0]?.clOrdId).toBe(CL_ORD_ID);
  });

  it("treats any unexpected txid as a critical unknown result", async () => {
    const gateway = new ScriptedGateway(async () => ({
      txid: ["O-UNEXPECTED"],
      descr: { order: "unexpected" },
    }));

    const result = await runLiveOrderPreflight(INTENT, CONSTRAINTS, gateway, OPTIONS);

    expect(result.status).toBe("unknown");
    expect(result.matchingEngineSubmission).toBeNull();
    expect(result.realOrderCreated).toBeNull();
    expect(result.anomaly).toBe("unexpected_txid:O-UNEXPECTED");
  });

  it("reports an explicit EOrder rejection without treating it as a transport ambiguity", async () => {
    const gateway = new ScriptedGateway(async () => {
      throw new KrakenApiError(["EOrder:Insufficient funds"]);
    });

    const result = await runLiveOrderPreflight(INTENT, CONSTRAINTS, gateway, OPTIONS);

    expect(result.status).toBe("rejected");
    expect(result.blockers).toEqual(["EOrder:Insufficient funds"]);
    expect(result.matchingEngineSubmission).toBe(false);
    expect(result.realOrderCreated).toBe(false);
  });

  it("keeps network and authentication failures unknown", async () => {
    const gateway = new ScriptedGateway(async () => {
      throw new Error("Kraken private HTTP 503");
    });

    const result = await runLiveOrderPreflight(INTENT, CONSTRAINTS, gateway, OPTIONS);

    expect(result.status).toBe("unknown");
    expect(result.matchingEngineSubmission).toBeNull();
    expect(result.realOrderCreated).toBeNull();
    expect(result.anomaly).toBe("unverified_transport_result");
  });

  it("blocks invalid or oversized intentions before contacting Kraken", async () => {
    const gateway = new ScriptedGateway(async () => ({ txid: [], descr: {} }));
    const result = await runLiveOrderPreflight(
      { ...INTENT, volumeBase: 0.0002, notionalEur: 10 },
      CONSTRAINTS,
      gateway,
      OPTIONS,
    );

    expect(result.status).toBe("rejected");
    expect(result.contactedKraken).toBe(false);
    expect(result.blockers.some((blocker) => blocker.includes("máximo permitido"))).toBe(true);
    expect(gateway.calls).toHaveLength(0);
  });
});
