import { describe, expect, it } from "vitest";
import type { StrategyBenchmarkSuite } from "../src/benchmark-suite";
import {
  advanceFrozenForwardExperiment,
  buildFrozenManifestJson,
  buildFrozenForwardReport,
  createFrozenForwardExperiment,
  frozenManifestHash,
  sanitizeFrozenForwardExperiment,
} from "../src/frozen-forward-experiment";
import { LAB_LANE_CONFIGS, type LabStrategyState, type LabTrade } from "../src/research-lab";

const NOW = 1_800_000_000_000;

function trade(id: string, side: "buy" | "sell", timestamp: number, pnlEur?: number): LabTrade {
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

function strategy(
  id = "intraday:XXBTZEUR",
  overrides: Partial<LabStrategyState> = {},
): LabStrategyState {
  return {
    id,
    lane: "intraday",
    pairKey: id.split(":")[1] ?? "XXBTZEUR",
    symbol: id.includes("ETH") ? "ETH/EUR" : "XBT/EUR",
    base: id.includes("ETH") ? "ETH" : "XBT",
    status: "active",
    initialCashEur: 50,
    cashEur: 50,
    equityEur: 50,
    peakEquityEur: 50,
    maxDrawdownPct: 0,
    position: null,
    config: { ...LAB_LANE_CONFIGS.intraday },
    estimatedOrderMinimumEur: 1,
    estimatedTakerRoundTripCostPct: 0.005,
    lastClosedCandleTime: null,
    lastAttemptAt: NOW,
    lastSuccessfulAt: NOW,
    nextDueAt: NOW + 60_000,
    lastTradeAt: null,
    lastDecision: "hold",
    cycles: 1,
    uniqueCandles: 1,
    duplicateSkips: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    performance: {
      buys: 0,
      sells: 0,
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      grossProfitEur: 0,
      grossLossEur: 0,
      netPnlEur: 0,
      totalFeesEur: 0,
    },
    trades: [],
    ...overrides,
  };
}

function suite(items: Array<{ id: string; buyHoldReturnPct: number | null }>): StrategyBenchmarkSuite {
  return {
    schemaVersion: "paper-benchmark-suite-v1",
    methodology: "test",
    strategyCount: items.length,
    measuredBuyHoldStrategies: items.filter((item) => item.buyHoldReturnPct !== null).length,
    outperformingCash: 0,
    outperformingBuyHold: 0,
    outperformingBestPassive: 0,
    entries: items.map((item) => ({
      strategyId: item.id,
      symbol: item.id.includes("ETH") ? "ETH/EUR" : "XBT/EUR",
      lane: "intraday",
      strategyReturnPct: 0,
      cashReturnPct: 0,
      buyHoldReturnPct: item.buyHoldReturnPct,
      bestPassiveReturnPct: Math.max(0, item.buyHoldReturnPct ?? 0),
      alphaVsCashPct: 0,
      alphaVsBuyHoldPct: item.buyHoldReturnPct === null ? null : -item.buyHoldReturnPct,
      alphaVsBestPassivePct: -Math.max(0, item.buyHoldReturnPct ?? 0),
      outperformedCash: false,
      outperformedBuyHold: false,
      outperformedBestPassive: false,
      benchmarkObservations: 100,
    })),
    leaderboard: [],
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

describe("frozen forward experiment", () => {
  it("builds the same manifest regardless of strategy ordering", async () => {
    const first = strategy("intraday:XXBTZEUR");
    const second = strategy("intraday:XETHZEUR");

    expect(buildFrozenManifestJson([first, second])).toBe(buildFrozenManifestJson([second, first]));
    expect(await frozenManifestHash([first, second])).toBe(await frozenManifestHash([second, first]));
  });

  it("excludes every retained historical trade from the forward baseline", async () => {
    const item = strategy("intraday:XXBTZEUR", {
      equityEur: 49.8,
      trades: [trade("old-sell", "sell", NOW - 1_000, -0.2), trade("old-buy", "buy", NOW - 2_000)],
    });
    const result = await advanceFrozenForwardExperiment(null, [item], suite([{ id: item.id, buyHoldReturnPct: 1 }]), NOW);
    const accumulator = result.state.strategies[item.id]!;

    expect(result.state.seenTradeIds).toEqual(expect.arrayContaining(["old-buy", "old-sell"]));
    expect(accumulator.forwardClosedTrades).toBe(0);
    expect(accumulator.forwardNetPnlEur).toBe(0);
    expect(accumulator.baselineEquityEur).toBe(49.8);
  });

  it("ignores the first post-freeze exit when a position was already open", async () => {
    const open = strategy("intraday:XXBTZEUR", {
      position: {
        quantity: 0.1,
        entryPrice: 100,
        entryTime: NOW - 5_000,
        costEur: 10.04,
        stopLoss: 98,
        takeProfit: 104,
      },
      trades: [trade("old-buy", "buy", NOW - 5_000)],
    });
    const baseline = await createFrozenForwardExperiment([open], suite([{ id: open.id, buyHoldReturnPct: 0 }]), NOW);
    const closedOldPosition = strategy(open.id, {
      trades: [trade("baseline-exit", "sell", NOW + 1_000, 0.4), trade("old-buy", "buy", NOW - 5_000)],
    });
    const first = await advanceFrozenForwardExperiment(baseline, [closedOldPosition], suite([{ id: open.id, buyHoldReturnPct: 0 }]), NOW + 1_000);

    expect(first.state.strategies[open.id]?.forwardClosedTrades).toBe(0);
    expect(first.state.strategies[open.id]?.pendingBaselinePositionExit).toBe(false);

    const completeForwardTrade = strategy(open.id, {
      trades: [
        trade("forward-sell", "sell", NOW + 3_000, 0.25),
        trade("forward-buy", "buy", NOW + 2_000),
        trade("baseline-exit", "sell", NOW + 1_000, 0.4),
        trade("old-buy", "buy", NOW - 5_000),
      ],
    });
    const second = await advanceFrozenForwardExperiment(first.state, [completeForwardTrade], suite([{ id: open.id, buyHoldReturnPct: 0 }]), NOW + 3_000);

    expect(second.state.strategies[open.id]?.forwardClosedTrades).toBe(1);
    expect(second.state.strategies[open.id]?.forwardNetPnlEur).toBe(0.25);
  });

  it("counts only new future sells once and does not mutate the prior state", async () => {
    const item = strategy();
    const baseline = await createFrozenForwardExperiment([item], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW);
    const originalAccumulator = baseline.strategies[item.id]!;
    const updated = strategy(item.id, {
      equityEur: 50.3,
      trades: [trade("future-sell", "sell", NOW + 2_000, 0.3), trade("future-buy", "buy", NOW + 1_000)],
    });
    const first = await advanceFrozenForwardExperiment(baseline, [updated], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW + 2_000);
    const second = await advanceFrozenForwardExperiment(first.state, [updated], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW + 3_000);

    expect(originalAccumulator.forwardClosedTrades).toBe(0);
    expect(first.state.strategies[item.id]?.forwardClosedTrades).toBe(1);
    expect(second.state.strategies[item.id]?.forwardClosedTrades).toBe(1);
    expect(second.state.strategies[item.id]?.forwardNetPnlEur).toBe(0.3);
  });

  it("detects configuration drift and never clears it after parameters are restored", async () => {
    const item = strategy();
    const baseline = await createFrozenForwardExperiment([item], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW);
    const changed = strategy(item.id, {
      config: { ...LAB_LANE_CONFIGS.intraday, takeProfitPct: 0.05 },
    });
    const drifted = await advanceFrozenForwardExperiment(baseline, [changed], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW + 1_000);
    const restored = await advanceFrozenForwardExperiment(drifted.state, [item], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW + 2_000);

    expect(drifted.state.configurationDriftDetected).toBe(true);
    expect(drifted.state.firstDriftDetectedAt).toBe(NOW + 1_000);
    expect(restored.state.configurationDriftDetected).toBe(true);
    expect(restored.report.parametersFrozen).toBe(false);
    expect(restored.report.researchReviewBlockers).toContain("Los parámetros o la cohorte de mercados cambiaron durante el experimento.");
  });

  it("uses cash when buy-and-hold declined and requires positive out-of-sample return", async () => {
    const item = strategy();
    const baselineSuite = suite([{ id: item.id, buyHoldReturnPct: -2 }]);
    const baseline = await createFrozenForwardExperiment([item], baselineSuite, NOW);
    const losing = strategy(item.id, { equityEur: 49.5 });
    const currentSuite = suite([{ id: item.id, buyHoldReturnPct: -4 }]);
    const result = await advanceFrozenForwardExperiment(baseline, [losing], currentSuite, NOW + 14 * 86_400_000);
    const report = result.report.strategies[0]!;

    expect(report.buyHoldReturnDeltaPct).toBe(-2);
    expect(report.bestPassiveReturnDeltaPct).toBe(0);
    expect(report.strategyReturnDeltaPct).toBe(-1);
    expect(report.outperformedBestPassive).toBe(false);
    expect(result.report.researchReviewCandidate).toBe(false);
  });

  it("requires fourteen days, thirty future closes, positive PnL and passive outperformance", async () => {
    const item = strategy();
    const state = await createFrozenForwardExperiment([item], suite([{ id: item.id, buyHoldReturnPct: 0 }]), NOW);
    state.initializedAt = NOW - 14 * 86_400_000;
    state.strategies[item.id] = {
      ...state.strategies[item.id]!,
      forwardClosedTrades: 30,
      forwardWinningTrades: 20,
      forwardLosingTrades: 10,
      forwardNetPnlEur: 2,
    };
    const profitable = strategy(item.id, { equityEur: 52 });
    const currentHash = await frozenManifestHash([profitable]);
    const report = buildFrozenForwardReport(state, [profitable], suite([{ id: item.id, buyHoldReturnPct: 1 }]), currentHash, NOW);

    expect(report.forwardDays).toBe(14);
    expect(report.forwardClosedTrades).toBe(30);
    expect(report.strategiesWithPositiveForwardPnl).toBe(1);
    expect(report.strategiesOutperformingBestPassive).toBe(1);
    expect(report.researchReviewCandidate).toBe(true);
    expect(report.researchReviewBlockers).toEqual([]);
    expect(report.changesTradingDecision).toBe(false);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.liveTrading).toBe(false);
  });

  it("rejects malformed persisted accumulators", async () => {
    const item = strategy();
    const valid = await createFrozenForwardExperiment([item], null, NOW);
    expect(sanitizeFrozenForwardExperiment(valid)).not.toBeNull();

    const malformed = {
      ...valid,
      strategies: {
        [item.id]: { ...valid.strategies[item.id], forwardClosedTrades: -1 },
      },
    };
    expect(sanitizeFrozenForwardExperiment(malformed)).toBeNull();
  });
});
