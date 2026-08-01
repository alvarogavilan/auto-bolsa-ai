import { describe, expect, it } from "vitest";
import {
  applyCommitteeTradeSnapshot,
  buildCommitteeShadowImpactReport,
  emptyCommitteeShadowImpactState,
} from "../src/committee-shadow-impact";
import type { ResearchCommitteeReport } from "../src/decision-committee";
import { LAB_LANE_CONFIGS, type LabStrategyState, type LabTrade } from "../src/research-lab";

const NOW = 1_800_000_000_000;

function trade(
  id: string,
  side: "buy" | "sell",
  timestamp: number,
  pnlEur?: number,
): LabTrade {
  return {
    id,
    side,
    timestamp,
    price: 100,
    quantity: 0.1,
    grossEur: 10,
    feeEur: 0.04,
    reason: side === "buy" ? "entry" : "exit",
    ...(pnlEur === undefined ? {} : { pnlEur }),
  };
}

function strategy(trades: LabTrade[]): LabStrategyState {
  return {
    id: "intraday:XXBTZEUR",
    lane: "intraday",
    pairKey: "XXBTZEUR",
    symbol: "XBT/EUR",
    base: "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 50,
    equityEur: 50,
    peakEquityEur: 50,
    maxDrawdownPct: 0,
    position: null,
    config: LAB_LANE_CONFIGS.intraday,
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: null,
    lastAttemptAt: NOW,
    lastSuccessfulAt: NOW,
    nextDueAt: NOW + 60_000,
    lastTradeAt: NOW,
    lastDecision: "test",
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: trades.filter((item) => item.side === "buy").length,
      sells: trades.filter((item) => item.side === "sell").length,
      closedTrades: trades.filter((item) => item.side === "sell").length,
      winningTrades: trades.filter((item) => (item.pnlEur ?? 0) > 0).length,
      losingTrades: trades.filter((item) => (item.pnlEur ?? 0) < 0).length,
      grossProfitEur: 0,
      grossLossEur: 0,
      netPnlEur: 0,
      totalFeesEur: trades.length * 0.04,
    },
    trades,
  };
}

function committee(
  verdict: "candidate" | "observe" | "vetoed",
  hardVetoCount: number,
): ResearchCommitteeReport {
  return {
    schemaVersion: "paper-research-committee-v1",
    generatedAt: NOW,
    strategyCount: 1,
    candidates: verdict === "candidate" ? 1 : 0,
    observing: verdict === "observe" ? 1 : 0,
    vetoed: verdict === "vetoed" ? 1 : 0,
    reports: [{
      schemaVersion: "paper-strategy-committee-v1",
      strategyId: "intraday:XXBTZEUR",
      symbol: "XBT/EUR",
      lane: "intraday",
      generatedAt: NOW,
      verdict,
      confidence: "qualified",
      votes: [{
        id: "risk",
        role: "Riesgo",
        vote: hardVetoCount > 0 ? "veto" : "approve",
        hardVeto: hardVetoCount > 0,
        reason: "test",
      }],
      hardVetoCount,
      approvals: hardVetoCount > 0 ? 5 : 6,
      observations: 0,
      vetoes: hardVetoCount > 0 ? 1 : 0,
      message: "test",
      changesTradingDecision: false,
      eligibleForLiveReview: false,
      liveTrading: false,
    }],
    methodology: "test",
    changesTradingDecision: false,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

describe("committee shadow impact ledger", () => {
  it("associates a committee snapshot with a buy and closes it with the next sell", () => {
    const trades = [
      trade("sell-1", "sell", NOW + 60_000, -0.25),
      trade("buy-1", "buy", NOW),
    ];
    const state = applyCommitteeTradeSnapshot(
      emptyCommitteeShadowImpactState(NOW),
      [strategy(trades)],
      committee("vetoed", 1),
      NOW + 60_000,
    );

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.entryTradeId).toBe("buy-1");
    expect(state.entries[0]?.exitTradeId).toBe("sell-1");
    expect(state.entries[0]?.pnlEur).toBe(-0.25);
    expect(state.entries[0]?.hardVetoCount).toBe(1);
  });

  it("is idempotent when the same retained trade history is processed repeatedly", () => {
    const trades = [trade("buy-1", "buy", NOW)];
    const first = applyCommitteeTradeSnapshot(
      emptyCommitteeShadowImpactState(NOW),
      [strategy(trades)],
      committee("observe", 0),
      NOW,
    );
    const second = applyCommitteeTradeSnapshot(first, [strategy(trades)], committee("observe", 0), NOW + 60_000);

    expect(second.entries).toHaveLength(1);
    expect(second.seenTradeIds).toEqual(["buy-1"]);
  });

  it("calculates avoided losses minus missed gains for hard veto entries", () => {
    let state = applyCommitteeTradeSnapshot(
      emptyCommitteeShadowImpactState(NOW),
      [strategy([trade("sell-loss", "sell", NOW + 60_000, -0.4), trade("buy-loss", "buy", NOW)])],
      committee("vetoed", 1),
      NOW + 60_000,
    );
    state = applyCommitteeTradeSnapshot(
      state,
      [strategy([
        trade("sell-gain", "sell", NOW + 180_000, 0.15),
        trade("buy-gain", "buy", NOW + 120_000),
        trade("sell-loss", "sell", NOW + 60_000, -0.4),
        trade("buy-loss", "buy", NOW),
      ])],
      committee("vetoed", 1),
      NOW + 180_000,
    );

    const report = buildCommitteeShadowImpactReport(state, NOW + 180_000);
    expect(report.hardVetoLossesAvoidedEur).toBe(0.4);
    expect(report.hardVetoGainsMissedEur).toBe(0.15);
    expect(report.hypotheticalHardVetoNetBenefitEur).toBe(0.25);
    expect(report.committeeAuthorityRecommended).toBe(false);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("keeps candidate results separate from observe results", () => {
    let state = applyCommitteeTradeSnapshot(
      emptyCommitteeShadowImpactState(NOW),
      [strategy([trade("buy-candidate", "buy", NOW)])],
      committee("candidate", 0),
      NOW,
    );
    state = applyCommitteeTradeSnapshot(
      state,
      [strategy([trade("sell-candidate", "sell", NOW + 60_000, 0.3), trade("buy-candidate", "buy", NOW)])],
      committee("candidate", 0),
      NOW + 60_000,
    );

    const report = buildCommitteeShadowImpactReport(state, NOW + 60_000);
    expect(report.candidateClosedEntries).toBe(1);
    expect(report.candidateNetPnlEur).toBe(0.3);
    expect(report.observeClosedEntries).toBe(0);
  });

  it("reports unmatched legacy exits without fabricating an entry", () => {
    const state = applyCommitteeTradeSnapshot(
      emptyCommitteeShadowImpactState(NOW),
      [strategy([trade("legacy-sell", "sell", NOW, -0.1)])],
      committee("observe", 0),
      NOW,
    );

    expect(state.entries).toHaveLength(0);
    expect(state.unmatchedExitTrades).toBe(1);
  });
});
