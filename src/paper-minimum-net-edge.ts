import type { LabStrategyState } from "./research-lab";

export const MIN_EXPECTED_NET_PROFIT_EUR = 0.05;
export const MIN_EXPECTED_NET_RETURN_PCT = 0.05;
export const MIN_EXPECTED_REWARD_TO_COST_RATIO = 2;
export const MIN_EXPECTED_REWARD_TO_RISK_RATIO = 1.5;

export interface PaperMinimumNetEdge {
  allowed: boolean;
  budgetEur: number;
  expectedGrossProfitEur: number;
  expectedRoundTripCostsEur: number;
  expectedNetProfitEur: number;
  expectedNetReturnPct: number;
  expectedLossAtStopEur: number;
  rewardToCostRatio: number;
  rewardToRiskRatio: number;
  minimumExpectedNetProfitEur: number;
  minimumExpectedNetReturnPct: number;
  minimumRewardToCostRatio: number;
  minimumRewardToRiskRatio: number;
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
  const expectedNetReturnPct = safeBudgetEur > 0 ? expectedNetProfitEur / safeBudgetEur : 0;
  const expectedLossAtStopEur = safeBudgetEur * (
    Math.max(0, strategy.config.stopLossPct)
    + Math.max(0, strategy.estimatedTakerRoundTripCostPct)
  );
  const rewardToCostRatio = expectedRoundTripCostsEur > 0
    ? expectedGrossProfitEur / expectedRoundTripCostsEur
    : expectedGrossProfitEur > 0 ? Number.POSITIVE_INFINITY : 0;
  const rewardToRiskRatio = expectedLossAtStopEur > 0
    ? expectedNetProfitEur / expectedLossAtStopEur
    : expectedNetProfitEur > 0 ? Number.POSITIVE_INFINITY : 0;
  const allowed = expectedNetProfitEur >= MIN_EXPECTED_NET_PROFIT_EUR
    && expectedNetReturnPct >= MIN_EXPECTED_NET_RETURN_PCT
    && rewardToCostRatio >= MIN_EXPECTED_REWARD_TO_COST_RATIO
    && rewardToRiskRatio >= MIN_EXPECTED_REWARD_TO_RISK_RATIO;

  return {
    allowed,
    budgetEur: rounded(safeBudgetEur),
    expectedGrossProfitEur: rounded(expectedGrossProfitEur),
    expectedRoundTripCostsEur: rounded(expectedRoundTripCostsEur),
    expectedNetProfitEur: rounded(expectedNetProfitEur),
    expectedNetReturnPct: rounded(expectedNetReturnPct),
    expectedLossAtStopEur: rounded(expectedLossAtStopEur),
    rewardToCostRatio: Number.isFinite(rewardToCostRatio) ? rounded(rewardToCostRatio) : rewardToCostRatio,
    rewardToRiskRatio: Number.isFinite(rewardToRiskRatio) ? rounded(rewardToRiskRatio) : rewardToRiskRatio,
    minimumExpectedNetProfitEur: MIN_EXPECTED_NET_PROFIT_EUR,
    minimumExpectedNetReturnPct: MIN_EXPECTED_NET_RETURN_PCT,
    minimumRewardToCostRatio: MIN_EXPECTED_REWARD_TO_COST_RATIO,
    minimumRewardToRiskRatio: MIN_EXPECTED_REWARD_TO_RISK_RATIO,
    liveTrading: false,
  };
}
