import { describe, expect, it } from "vitest";
import type { LiveOrderRequest } from "../src/live-executor";
import type {
  LiveOrderPreflightIntent,
  LiveOrderPreflightResult,
} from "../src/live-order-preflight";
import {
  checkLivePreflightCertificate,
  consumeLivePreflightCertificate,
  createLivePreflightCertificate,
} from "../src/live-preflight-certificate";

const CHECKED_AT = 1_800_000_000_000;
const CL_ORD_ID = "00000000-0000-4000-8000-000000000001";

const INTENT: LiveOrderPreflightIntent = {
  pair: "XBTEUR",
  side: "buy",
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

const RESULT: LiveOrderPreflightResult = {
  status: "validated",
  checkedAt: CHECKED_AT,
  contactedKraken: true,
  validateFlagForced: true,
  matchingEngineSubmission: false,
  realOrderCreated: false,
  clOrdId: CL_ORD_ID,
  blockers: [],
  message: "validated only",
  description: "buy 0.0001 XBTEUR @ limit 50000",
  anomaly: null,
};

const REQUEST: LiveOrderRequest = {
  idempotencyKey: "pilot-1",
  pair: "XBTEUR",
  side: "buy",
  volumeBase: 0.0001,
  limitPrice: 50_000,
  notionalEur: 5,
};

async function certificate() {
  return createLivePreflightCertificate(INTENT, RESULT, {
    ttlMs: 120_000,
    certificateIdFactory: () => "certificate-1",
  });
}

describe("LIVE preflight one-use certificate", () => {
  it("allows only the exact clOrdId and order while the certificate is fresh", async () => {
    const issued = await certificate();
    expect(issued.certificateId).toBe("certificate-1");
    expect(issued.consumedAt).toBeNull();
    expect(issued.expiresAt).toBe(CHECKED_AT + 120_000);

    const check = await checkLivePreflightCertificate(
      issued,
      CL_ORD_ID,
      REQUEST,
      CHECKED_AT + 1_000,
    );
    expect(check).toEqual({ allowed: true, blockers: [] });
  });

  it("blocks any change to pair, side, volume, price or notional", async () => {
    const issued = await certificate();
    const variants: LiveOrderRequest[] = [
      { ...REQUEST, pair: "ETHEUR" },
      { ...REQUEST, side: "sell" },
      { ...REQUEST, volumeBase: 0.00011 },
      { ...REQUEST, limitPrice: 50_001 },
      { ...REQUEST, notionalEur: 4.99 },
    ];

    for (const request of variants) {
      const check = await checkLivePreflightCertificate(issued, CL_ORD_ID, request, CHECKED_AT + 1_000);
      expect(check.allowed).toBe(false);
      expect(check.blockers).toContain("La orden no coincide exactamente con la intención validada");
    }
  });

  it("blocks a different clOrdId even when the economic intent is identical", async () => {
    const issued = await certificate();
    const check = await checkLivePreflightCertificate(
      issued,
      "00000000-0000-4000-8000-000000000002",
      REQUEST,
      CHECKED_AT + 1_000,
    );
    expect(check.allowed).toBe(false);
    expect(check.blockers).toContain("clOrdId distinto del validado por Kraken");
  });

  it("expires quickly and cannot be used twice", async () => {
    const issued = await certificate();
    const expired = await checkLivePreflightCertificate(
      issued,
      CL_ORD_ID,
      REQUEST,
      CHECKED_AT + 120_000,
    );
    expect(expired.allowed).toBe(false);
    expect(expired.blockers).toContain("El certificado ha caducado");

    const consumed = await consumeLivePreflightCertificate(
      issued,
      CL_ORD_ID,
      REQUEST,
      CHECKED_AT + 1_000,
    );
    expect(consumed.consumedAt).toBe(CHECKED_AT + 1_000);

    const reused = await checkLivePreflightCertificate(
      consumed,
      CL_ORD_ID,
      REQUEST,
      CHECKED_AT + 2_000,
    );
    expect(reused.allowed).toBe(false);
    expect(reused.blockers).toContain("El certificado ya fue consumido");
  });

  it("detects mutation of the certified intent", async () => {
    const issued = await certificate();
    const tampered = {
      ...issued,
      intent: { ...issued.intent, limitPrice: 49_000 },
    };
    const check = await checkLivePreflightCertificate(
      tampered,
      CL_ORD_ID,
      { ...REQUEST, limitPrice: 49_000, notionalEur: 4.9 },
      CHECKED_AT + 1_000,
    );
    expect(check.allowed).toBe(false);
    expect(check.blockers).toContain("La huella almacenada no coincide con el contenido del certificado");
  });

  it("refuses to issue a certificate for rejected, ambiguous or anomalous results", async () => {
    const invalidResults: LiveOrderPreflightResult[] = [
      { ...RESULT, status: "rejected", blockers: ["EOrder:Order minimum not met"] },
      {
        ...RESULT,
        status: "unknown",
        matchingEngineSubmission: null,
        realOrderCreated: null,
        anomaly: "unverified_transport_result",
      },
      { ...RESULT, anomaly: "unexpected_txid:O-REAL" },
      { ...RESULT, contactedKraken: false },
    ];

    for (const result of invalidResults) {
      await expect(createLivePreflightCertificate(INTENT, result)).rejects.toThrow("No se puede emitir el certificado");
    }
  });

  it("rejects excessive certificate lifetimes", async () => {
    await expect(
      createLivePreflightCertificate(INTENT, RESULT, { ttlMs: 300_001 }),
    ).rejects.toThrow("TTL inválido");
  });
});
