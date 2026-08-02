import type { LabPosition, LabStrategyState } from "./research-lab";

export interface PaperExitEconomics {
  rawTriggerPrice: number;
  executableExitPrice: number;
  breakEvenRawPrice: number;
  targetNetProceedsEur: number;
  projectedGrossEur: number;
  projectedExitFeeEur: number;
  projectedNetProceedsEur: number;
  projectedNetPnlEur: number;
  entryCostEur: number;
  entryFeeEur: number;
  estimatedTotalFeesEur: number;
  estimatedTotalSlippageEur: number;
  targetNetReturnPct: number;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function calculatePaperExitEconomics(
  position: LabPosition,
  strategy: Pick<LabStrategyState, "config">,
  targetNetReturnPct = strategy.config.takeProfitPct,
): PaperExitEconomics {
  const quantity = positive(position.quantity, 0.00000001);
  const feePct = Math.max(0, strategy.config.feePctEachSide);
  const slippagePct = Math.max(0, strategy.config.slippagePctEachSide);
  const entryCostEur = Math.max(0, position.costEur);
  const entryGrossEur = quantity * position.entryPrice;
  const entryFeeEur = Math.max(0, entryCostEur - entryGrossEur);
  const targetNetProceedsEur = entryCostEur * (1 + Math.max(0, targetNetReturnPct));
  const executableExitPrice = targetNetProceedsEur / (quantity * Math.max(0.00000001, 1 - feePct));
  const rawTriggerPrice = executableExitPrice / Math.max(0.00000001, 1 - slippagePct);
  const breakEvenExecutablePrice = entryCostEur / (quantity * Math.max(0.00000001, 1 - feePct));
  const breakEvenRawPrice = breakEvenExecutablePrice / Math.max(0.00000001, 1 - slippagePct);
  const projectedGrossEur = quantity * executableExitPrice;
  const projectedExitFeeEur = projectedGrossEur * feePct;
  const projectedNetProceedsEur = projectedGrossEur - projectedExitFeeEur;
  const projectedNetPnlEur = projectedNetProceedsEur - entryCostEur;
  const estimatedExitSlippageEur = Math.max(0, quantity * rawTriggerPrice - projectedGrossEur);
  const estimatedEntrySlippageEur = Math.max(0, quantity * position.entryPrice * slippagePct / Math.max(0.00000001, 1 + slippagePct));

  return {
    rawTriggerPrice: money(rawTriggerPrice),
    executableExitPrice: money(executableExitPrice),
    breakEvenRawPrice: money(breakEvenRawPrice),
    targetNetProceedsEur: money(targetNetProceedsEur),
    projectedGrossEur: money(projectedGrossEur),
    projectedExitFeeEur: money(projectedExitFeeEur),
    projectedNetProceedsEur: money(projectedNetProceedsEur),
    projectedNetPnlEur: money(projectedNetPnlEur),
    entryCostEur: money(entryCostEur),
    entryFeeEur: money(entryFeeEur),
    estimatedTotalFeesEur: money(entryFeeEur + projectedExitFeeEur),
    estimatedTotalSlippageEur: money(estimatedEntrySlippageEur + estimatedExitSlippageEur),
    targetNetReturnPct: Math.max(0, targetNetReturnPct),
  };
}

export function applyNetTakeProfitToPosition(strategy: LabStrategyState): PaperExitEconomics | null {
  if (!strategy.position) return null;
  const economics = calculatePaperExitEconomics(strategy.position, strategy);
  strategy.position.takeProfit = economics.rawTriggerPrice;
  return economics;
}

export function projectedNetPnlAtRawPrice(
  position: LabPosition,
  strategy: Pick<LabStrategyState, "config">,
  rawPrice: number,
): number {
  const executablePrice = rawPrice * (1 - Math.max(0, strategy.config.slippagePctEachSide));
  const grossEur = position.quantity * executablePrice;
  const exitFeeEur = grossEur * Math.max(0, strategy.config.feePctEachSide);
  return money(grossEur - exitFeeEur - position.costEur);
}
