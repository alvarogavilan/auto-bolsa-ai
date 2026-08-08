import { describe, expect, it } from "vitest";
import type { LiveInventory } from "../src/live-executor";
import type { PilotValidationProposal } from "../src/pilot-validation-proposal";
import type { XauPaperInstruction } from "../src/xau-usd-paper-runtime";
import { buildXauPaxgSpotIntent } from "../src/xau-paxg-spot-intent";

function instruction(action: "buy" | "sell" | "hold", allowed = true): XauPaperInstruction {
  return {
    schemaVersion: "xau-usd-paper-instruction-v1",
    createdAt: 1_000,
    market: "XAU/USD",
    mode: "paper",
    cycleKind: "decision",
    action,
    allowed,
    budgetEur: allowed ? 5 : 0,
    referencePrice: action === "hold" ? null : 4_000,
    stopPrice: action === "hold" ? null : 3_950,
    initialTargetPrice: action === "hold" ? null : 4_100,
    rewardRisk: 2,
    quoteAgeMs: 100,
    quoteSource: "test",
    cabinetDecision: {} as XauPaperInstruction["cabinetDecision"],
    sizing: {} as XauPaperInstruction["sizing"],
    blockers: [],
    liveTrading: false,
    realOrderSubmission: false,
  };
}

const proposal = {
  pair: "PAXGEUR",
  request: {
    idempotencyKey: "validate-only-old",
    pair: "PAXGEUR",
    side: "buy",
    volumeBase: 0.0012,
    limitPrice: 4_000,
    notionalEur: 4.8,
  },
} as PilotValidationProposal;

const flat: LiveInventory = { pair: null, quantityBase: 0, averageCostEur: null, reservedQuantityBase: 0 };

describe("XAU to PAXG Spot intent", () => {
  it("opens PAXG only for an approved XAU BUY while account is flat", () => {
    const result = buildXauPaxgSpotIntent(instruction("buy"), proposal, flat, 2_000);
    expect(result.allowed).toBe(true);
    expect(result.action).toBe("open-long");
    expect(result.request?.pair).toBe("PAXGEUR");
    expect(result.request?.side).toBe("buy");
    expect(result.request?.idempotencyKey).toBe("xau-paxg-open:1000");
  });

  it("never turns an XAU SELL into a naked PAXG short", () => {
    const result = buildXauPaxgSpotIntent(instruction("sell"), null, flat, 2_000);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("hold");
    expect(result.request).toBeNull();
    expect(result.blockers.join(" ")).toContain("no admite abrir un corto");
    expect(result.shortSellingSupported).toBe(false);
  });

  it("does not pyramid another PAXG BUY over existing inventory", () => {
    const inventory: LiveInventory = { pair: "PAXGEUR", quantityBase: 0.001, averageCostEur: 4_000, reservedQuantityBase: 0 };
    const result = buildXauPaxgSpotIntent(instruction("buy"), proposal, inventory, 2_000);
    expect(result.allowed).toBe(false);
    expect(result.blockers.join(" ")).toContain("no se permite piramidar");
  });

  it("requires a real PAXG price before converting SELL into a close order", () => {
    const inventory: LiveInventory = { pair: "PAXGEUR", quantityBase: 0.001, averageCostEur: 4_000, reservedQuantityBase: 0 };
    const result = buildXauPaxgSpotIntent(instruction("sell"), null, inventory, 2_000);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("close-long");
    expect(result.blockers.join(" ")).toContain("precio PAXG/EUR real");
  });

  it("blocks an unapproved XAU instruction", () => {
    const result = buildXauPaxgSpotIntent(instruction("buy", false), proposal, flat, 2_000);
    expect(result.allowed).toBe(false);
    expect(result.request).toBeNull();
  });
});
