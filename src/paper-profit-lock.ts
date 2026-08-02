import type { LabPosition, LabStrategyState } from "./research-lab";
import { calculatePaperExitEconomics, projectedNetPnlAtRawPrice } from "./paper-net-exit";

export const PAPER_TRAILING_ACTIVATION_R = 1;
export const PAPER_TRAILING_DISTANCE_R = 0.75;
export const PAPER_LOCKED_PROFIT_R = 0.25;

export interface PaperProfitLockDecision {
  activated: boolean;
  trailingActive: boolean;
  previousStopLoss: number;
  nextStopLoss: number;
  protectedNetPnlEur: number;
  currentNetPnlEur: number;
  reason: string;
  liveTrading: false;
}

function initialRiskDistance(position: LabPosition): number {
  return Math.max(0, position.entryPrice - position.stopLoss);
}

/**
 * Moves a PAPER stop only in the profitable direction. Activation waits for
 * one initial risk unit, then protects true net break-even plus part of the
 * gain while allowing the target to expand. It never loosens an existing stop.
 */
export function managePaperProfitLock(
  position: LabPosition,
  strategy: Pick<LabStrategyState, "config">,
  rawPrice: number,
): PaperProfitLockDecision {
  const previousStopLoss = position.stopLoss;
  const riskDistance = initialRiskDistance(position);
  const trailingWasActive = previousStopLoss >= position.entryPrice;
  const activationPrice = position.entryPrice + riskDistance * PAPER_TRAILING_ACTIVATION_R;
  const currentNetPnlEur = projectedNetPnlAtRawPrice(position, strategy, rawPrice);

  if (!trailingWasActive && (riskDistance <= 0 || rawPrice < activationPrice || currentNetPnlEur <= 0)) {
    return {
      activated: false,
      trailingActive: false,
      previousStopLoss,
      nextStopLoss: previousStopLoss,
      protectedNetPnlEur: projectedNetPnlAtRawPrice(position, strategy, previousStopLoss),
      currentNetPnlEur,
      reason: "Beneficio todavía insuficiente para mover el stop.",
      liveTrading: false,
    };
  }

  const economics = calculatePaperExitEconomics(position, strategy, 0);
  const lockedProfitPrice = position.entryPrice + riskDistance * PAPER_LOCKED_PROFIT_R;
  const trailingPrice = rawPrice - riskDistance * PAPER_TRAILING_DISTANCE_R;
  const nextStopLoss = Math.max(previousStopLoss, economics.breakEvenRawPrice, lockedProfitPrice, trailingPrice);
  position.stopLoss = nextStopLoss;
  position.takeProfit = Math.max(position.takeProfit, rawPrice + riskDistance);

  return {
    activated: !trailingWasActive,
    trailingActive: true,
    previousStopLoss,
    nextStopLoss,
    protectedNetPnlEur: projectedNetPnlAtRawPrice(position, strategy, nextStopLoss),
    currentNetPnlEur,
    reason: !trailingWasActive
      ? "Stop trasladado por encima del equilibrio para proteger beneficio y dejar correr la posición."
      : "Trailing stop elevado; nunca retrocede y mantiene abierta la opción de una ganancia mayor.",
    liveTrading: false,
  };
}
