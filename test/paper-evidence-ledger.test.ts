import { describe, expect, it } from "vitest";
import { buildCostSequenceStressReport } from "../src/cost-sequence-stress";
import {
  applyPaperEvidenceSnapshot,
  buildPaperEvidenceLedgerReport,
  emptyPaperEvidenceLedgerState,
  hydrateStrategiesWithEvidence,
  MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY,
  sanitizePaperEvidenceLedgerState,
} from "../src/paper-evidence-ledger";
import { LAB_LANE_CONFIGS, type LabStrategyState, type LabTrade } from "../src/research-lab";
import { buildTemporalValidationReport } from "../src/temporal-validation";

const START = 1_800_000_000_000;

function trade(index: number, side: "buy" | "sell", pnlEur?: number): LabTrade {
  const base: LabTrade = {
    id: `${side}-${index}`,
    side,
    timestamp: START + index * 60_000 + (side === "sell" ? 30_000 : 0),
    price: 100,
    quantity: 0.1,
    grossEur: 10,
    feeEur: 0.04,
    reason: "Evidence fixture",
  };
  if (typeof pnlEur === "number") base.pnlEur = pnlEur;
  return base;
}

function roundTrips(count: number): LabTrade[] {
  const result: LabTrade[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(trade(index * 2, "buy"));
    result.push(trade(index * 2 + 1, "sell", index % 4 === 0 ? -0.05 : 0.2));
  }
  return result;
}

function strategy(trades: LabTrade[], id = "intraday:XXBTZEUR"): LabStrategyState {
  const sells = trades.filter((item) => item.side === "sell" && typeof item.pnlEur === "number");
  const pnls = sells.map((item) => item.pnlEur ?? 0);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  return {
    id,
    lane: "intraday",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 50 + pnls.reduce((sum, value) => sum + value, 0),
    equityEur: 50 + pnls.reduce((sum, value) => sum + value, 0),
    peakEquityEur: 55,
    maxDrawdownPct: 0.02,
    position: null,
    config: LAB_LANE_CONFIGS.intraday,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: 1_700_000_000,
    lastAttemptAt: START,
    lastSuccessfulAt: START,
    nextDueAt: START + 60_000,
    lastTradeAt: START,
    lastDecision: "Sin señal válida",
    cycles: 400,
    uniqueCandles: 320,
    duplicateSkips: 80,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: trades.filter((item) => item.side === "buy").length,
      sells: sells.length,
      closedTrades: sells.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      grossProfitEur: wins.reduce((sum, value) => sum + value, 0),
      grossLossEur: losses.reduce((sum, value) => sum + Math.abs(value), 0),
      netPnlEur: pnls.reduce((sum, value) => sum + value, 0),
      totalFeesEur: trades.reduce((sum, item) => sum + item.feeEur, 0),
    },
    trades: [...trades].sort((left, right) => right.timestamp - left.timestamp),
  };
}

describe("persistent PAPER evidence ledger", () => {
  it("is idempotent when the retained strategy history repeats", () => {
    const current = strategy(roundTrips(5));
    const first = applyPaperEvidenceSnapshot(emptyPaperEvidenceLedgerState(START), [current], START + 1);
    const second = applyPaperEvidenceSnapshot(first, [current], START + 2);

    expect(first.strategies[current.id]?.trades).toHaveLength(10);
    expect(second.strategies[current.id]?.trades).toHaveLength(10);
    expect(new Set(second.seenTradeIds).size).toBe(second.seenTradeIds.length);
  });

  it("retains old evidence after it disappears from the visible strategy array", () => {
    const complete = roundTrips(8);
    const current = strategy(complete);
    const first = applyPaperEvidenceSnapshot(emptyPaperEvidenceLedgerState(START), [current], START + 1);
    const visibleTail = strategy(complete.slice(-4));
    const second = applyPaperEvidenceSnapshot(first, [visibleTail], START + 2);

    expect(visibleTail.trades).toHaveLength(4);
    expect(second.strategies[current.id]?.trades).toHaveLength(16);
    expect(buildPaperEvidenceLedgerReport(second).closedTrades).toBe(8);
  });

  it("caps each strategy at one thousand movements without duplicating retained IDs", () => {
    const movements = Array.from({ length: 1_100 }, (_, index) =>
      trade(index, index % 2 === 0 ? "buy" : "sell", index % 2 === 0 ? undefined : 0.05),
    );
    const item = strategy(movements);
    const ledger = applyPaperEvidenceSnapshot(emptyPaperEvidenceLedgerState(START), [item], START + 1);
    const retained = ledger.strategies[item.id]?.trades ?? [];

    expect(retained).toHaveLength(MAX_PAPER_EVIDENCE_MOVEMENTS_PER_STRATEGY);
    expect(retained[0]?.id).toBe("buy-100");
    expect(retained.at(-1)?.id).toBe("sell-1099");
    expect(new Set(retained.map((entry) => entry.id)).size).toBe(retained.length);
  });

  it("hydrates temporal and stress validation beyond the visible fifty round trips", () => {
    const complete = roundTrips(70);
    const full = strategy(complete);
    const ledger = applyPaperEvidenceSnapshot(emptyPaperEvidenceLedgerState(START), [full], START + 1);
    const truncated = strategy(complete.slice(-100));
    const hydrated = hydrateStrategiesWithEvidence([truncated], ledger);

    expect(truncated.trades).toHaveLength(100);
    expect(hydrated[0]?.trades).toHaveLength(140);
    expect(buildTemporalValidationReport(hydrated).entries[0]?.totalClosedTrades).toBe(70);
    expect(buildCostSequenceStressReport(hydrated).entries[0]?.closedRoundTrips).toBe(70);
  });

  it("sanitizes malformed persisted data and keeps all authority flags disabled", () => {
    const sanitized = sanitizePaperEvidenceLedgerState({
      schemaVersion: "wrong",
      strategies: { broken: { trades: "not-an-array" } },
      liveTrading: true,
    }, START);
    const report = buildPaperEvidenceLedgerReport(sanitized, START);

    expect(sanitized.strategies).toEqual({});
    expect(sanitized.changesTradingDecision).toBe(false);
    expect(sanitized.liveTrading).toBe(false);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
  });
});
