import type { LabStrategyState } from "./research-lab";

export const MIN_EXPECTED_NET_PROFIT_EUR = 0.05;
export const MIN_EXPECTED_REWARD_TO_COST_RATIO = 2;

export interface PaperMinimumNetEdge {
  allowed: boolean;
  budgetEur: number;
  expectedGrossProfitEur: number;
  expectedRoundTripCostsEur: number;
  expectedNetProfitEur: number;
  rewardToCostRatio: number;
  minimumExpectedNetProfitEur: number;
  minimumRewardToCostRatio: number;
  liveTrading: false;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function evaluatePaperMinimumNetEdge(
  strategy: LabStrategyState,
  budgetEur: number,
): PaperMinimumNetEdge {
  const safeBudgetEur = Math.max(0, budgetEur);
  const expectedGrossProfitEur = safeBudgetEur * Math.max(0, strategy.config.takeProfitPct);
  const expectedRoundTripCostsEur = safeBudgetEur * Math.max(0, strategy.estimatedTakerRoundTripCostPct);
  const expectedNetProfitEur = expectedGrossProfitEur - expectedRoundTripCostsEur;
  const rewardToCostRatio = expectedRoundTripCostsEur > 0
    ? expectedGrossProfitEur / expectedRoundTripCostsEur
    : expectedGrossProfitEur > 0 ? Number.POSITIVE_INFINITY : 0;
  const allowed = expectedNetProfitEur >= MIN_EXPECTED_NET_PROFIT_EUR
    && rewardToCostRatio >= MIN_EXPECTED_REWARD_TO_COST_RATIO;

  return {
    allowed,
    budgetEur: rounded(safeBudgetEur),
    expectedGrossProfitEur: rounded(expectedGrossProfitEur),
    expectedRoundTripCostsEur: rounded(expectedRoundTripCostsEur),
    expectedNetProfitEur: rounded(expectedNetProfitEur),
    rewardToCostRatio: Number.isFinite(rewardToCostRatio) ? rounded(rewardToCostRatio) : rewardToCostRatio,
    minimumExpectedNetProfitEur: MIN_EXPECTED_NET_PROFIT_EUR,
    minimumRewardToCostRatio: MIN_EXPECTED_REWARD_TO_COST_RATIO,
    liveTrading: false,
  };
}
