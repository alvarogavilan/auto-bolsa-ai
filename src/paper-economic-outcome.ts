export type PaperEconomicOutcome = "meaningful-win" | "micro-win" | "flat" | "loss";

export interface PaperEconomicAssessment {
  outcome: PaperEconomicOutcome;
  netPnlEur: number;
  allocatedEur: number;
  minimumMeaningfulProfitEur: number;
  economicallyMeaningful: boolean;
  countsAsWin: boolean;
  reason: string;
}

export const ABSOLUTE_MINIMUM_MEANINGFUL_PROFIT_EUR = 0.5;
export const MINIMUM_MEANINGFUL_RETURN_PCT = 0.05;
export const FLAT_TOLERANCE_EUR = 0.005;

export function minimumMeaningfulPaperProfitEur(allocatedEur: number): number {
  const safeAllocation = Number.isFinite(allocatedEur) ? Math.max(0, allocatedEur) : 0;
  return Math.max(
    ABSOLUTE_MINIMUM_MEANINGFUL_PROFIT_EUR,
    safeAllocation * MINIMUM_MEANINGFUL_RETURN_PCT,
  );
}

export function assessPaperEconomicOutcome(
  netPnlEur: number,
  allocatedEur: number,
): PaperEconomicAssessment {
  const safePnl = Number.isFinite(netPnlEur) ? netPnlEur : 0;
  const safeAllocation = Number.isFinite(allocatedEur) ? Math.max(0, allocatedEur) : 0;
  const minimumMeaningfulProfitEur = minimumMeaningfulPaperProfitEur(safeAllocation);

  if (safePnl >= minimumMeaningfulProfitEur) {
    return {
      outcome: "meaningful-win",
      netPnlEur: safePnl,
      allocatedEur: safeAllocation,
      minimumMeaningfulProfitEur,
      economicallyMeaningful: true,
      countsAsWin: true,
      reason: "Beneficio neto material después de costes.",
    };
  }

  if (safePnl > FLAT_TOLERANCE_EUR) {
    return {
      outcome: "micro-win",
      netPnlEur: safePnl,
      allocatedEur: safeAllocation,
      minimumMeaningfulProfitEur,
      economicallyMeaningful: false,
      countsAsWin: false,
      reason: "Resultado positivo de céntimos: se conserva en PnL, pero no cuenta como victoria económica.",
    };
  }

  if (safePnl >= -FLAT_TOLERANCE_EUR) {
    return {
      outcome: "flat",
      netPnlEur: safePnl,
      allocatedEur: safeAllocation,
      minimumMeaningfulProfitEur,
      economicallyMeaningful: false,
      countsAsWin: false,
      reason: "Resultado prácticamente plano después de costes.",
    };
  }

  return {
    outcome: "loss",
    netPnlEur: safePnl,
    allocatedEur: safeAllocation,
    minimumMeaningfulProfitEur,
    economicallyMeaningful: true,
    countsAsWin: false,
    reason: "Pérdida neta real; debe permanecer en el historial y las métricas.",
  };
}
