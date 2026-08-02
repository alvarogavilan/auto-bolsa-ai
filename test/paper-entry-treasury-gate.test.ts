import { describe, expect, it } from "vitest";
import type { LabStrategyState, ResearchLabState } from "../src/research-lab";
import {
  capturePaperEntrySnapshot,
  enforcePaperTreasuryEntry,
} from "../src/paper-entry-treasury-gate";

function strategy(id: string, costEur = 0): LabStrategyState {
  return {
    id,
    lane: "fast",
    pairKey: id,
    symbol: `${id}/EUR`,
    base: id,
    status: "active",
    initialCashEur: 100,
    cashEur: 100 - costEur,
    equityEur: 100,
    peakEquityEur: 100,
    maxDrawdownPct: 0,
    position: costEur > 0 ? { quantity: costEur, entryPrice: 1, entryTime: 1, costEur, stopLoss: 0.98, takeProfit: 1.04 } : null,
    config: { id: "fast", intervalMinutes: 5, fastPeriod: 5, slowPeriod: 13, rsiPeriod: 7, buyRsiMinimum: 46, buyRsiMaximum: 62, sellRsi: 68, stopLossPct: 0.02, takeProfitPct: 0.04, cooldownMinutes: 20, maximumHoldingMinutes: 180, feePctEachSide: 0.004, slippagePctEachSide: 0.001 },
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.01,
    lastClosedCandleTime: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextDueAt: 0,
    lastTradeAt: null,
    lastDecision: "test",
    cycles: 0,
    uniqueCandles: 0,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: { buys: costEur > 0 ? 1 : 0, sells: 0, closedTrades: 0, winningTrades: 0, losingTrades: 0, grossProfitEur: 0, grossLossEur: 0, netPnlEur: 0, totalFeesEur: costEur > 0 ? costEur * 0.004 : 0 },
    trades: costEur > 0 ? [{ id: `${id}-buy`, side: "buy", timestamp: 1, price: 1, quantity: costEur, grossEur: costEur, feeEur: costEur * 0.004, reason: "test" }] : [],
  };
}

function state(strategies: LabStrategyState[]): ResearchLabState {
  return { schemaVersion: "multi-horizon-paper-lab-v1", version: "0.17.0-paper", mode: "paper", initializedAt: 1, cohortLockedUntil: 2, sourceUniverseGeneratedAt: 1, lastCycleAt: 1, cycles: 1, strategies, liveTrading: false };
}

function mutateEntry(item: LabStrategyState, grossEur: number): void {
  const feeEur = grossEur * item.config.feePctEachSide;
  item.cashEur -= grossEur + feeEur;
  item.position = { quantity: grossEur, entryPrice: 1, entryTime: 2, costEur: grossEur + feeEur, stopLoss: 0.98, takeProfit: 1.04 };
  item.performance.buys += 1;
  item.performance.totalFeesEur += feeEur;
  item.trades.unshift({ id: `${item.id}-new`, side: "buy", timestamp: 2, price: 1, quantity: grossEur, grossEur, feeEur, reason: "candidate" });
}

describe("transactional PAPER treasury gate", () => {
  it("allows a useful 5 EUR entry and records treasury authorization", () => {
    const candidate = strategy("candidate");
    const lab = state([candidate, strategy("existing", 10)]);
    const before = capturePaperEntrySnapshot(candidate);
    mutateEntry(candidate, 5);
    const result = enforcePaperTreasuryEntry(candidate, lab, before);
    expect(result.allowed).toBe(true);
    expect(candidate.position?.costEur).toBeCloseTo(5.02, 6);
    expect(candidate.lastDecision).toContain("Autorización Tesorería");
  });

  it("rolls back micro entries and aggregate over-allocation before persistence", () => {
    const micro = strategy("micro");
    const microLab = state([micro]);
    const microBefore = capturePaperEntrySnapshot(micro);
    mutateEntry(micro, 1);
    expect(enforcePaperTreasuryEntry(micro, microLab, microBefore).allowed).toBe(false);
    expect(micro.position).toBeNull();
    expect(micro.trades).toHaveLength(0);

    const blocked = strategy("blocked");
    const saturated = state([blocked, strategy("a", 10), strategy("b", 10), strategy("c", 10), strategy("d", 5)]);
    const blockedBefore = capturePaperEntrySnapshot(blocked);
    mutateEntry(blocked, 5);
    expect(enforcePaperTreasuryEntry(blocked, saturated, blockedBefore).allowed).toBe(false);
    expect(blocked.position).toBeNull();
    expect(blocked.lastDecision).toContain("Tesorería única");
  });

  it("does not rewrite inherited small positions", () => {
    const inherited = strategy("legacy", 0.0655);
    const before = capturePaperEntrySnapshot(inherited);
    const result = enforcePaperTreasuryEntry(inherited, state([inherited]), before);
    expect(result.newEntryDetected).toBe(false);
    expect(inherited.position?.costEur).toBe(0.0655);
  });
});
