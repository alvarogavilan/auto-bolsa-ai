import type { ResearchLabState } from "./research-lab";

export interface EconomicSignificanceReport {
  schemaVersion: "paper-economic-significance-v1";
  generatedAt: number;
  capitalReferenceEur: number;
  closedTrades: number;
  meaningfulWins: number;
  microWins: number;
  losses: number;
  averageWinEur: number | null;
  averageLossEur: number | null;
  largestWinEur: number | null;
  largestLossEur: number | null;
  netPnlEur: number;
  minimumMeaningfulWinEur: number;
  warning: string | null;
  liveTrading: false;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function minimumMeaningfulWinEur(capitalEur: number): number {
  // No se exige 1 EUR fijo con una cuenta PAPER de 50 EUR: implicaría forzar
  // movimientos o tamaños de posición incompatibles con la política de riesgo.
  // El suelo crece con el capital y evita considerar útiles ganancias de
  // milésimas de euro.
  return Math.max(0.05, Math.min(1, capitalEur * 0.002));
}

export function buildEconomicSignificanceReport(
  state: ResearchLabState | null,
  now = Date.now(),
): EconomicSignificanceReport {
  const strategies = state?.strategies ?? [];
  const capitalReferenceEur = strategies.length > 0
    ? strategies.reduce((sum, strategy) => sum + strategy.initialCashEur, 0) / strategies.length
    : 50;
  const floor = minimumMeaningfulWinEur(capitalReferenceEur);
  const pnls = strategies.flatMap((strategy) => strategy.trades)
    .filter((trade) => trade.side === "sell" && typeof trade.pnlEur === "number")
    .map((trade) => trade.pnlEur as number);
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const meaningfulWins = wins.filter((pnl) => pnl >= floor);
  const microWins = wins.filter((pnl) => pnl < floor);
  const average = (values: number[]): number | null => values.length
    ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;

  return {
    schemaVersion: "paper-economic-significance-v1",
    generatedAt: now,
    capitalReferenceEur: round(capitalReferenceEur),
    closedTrades: pnls.length,
    meaningfulWins: meaningfulWins.length,
    microWins: microWins.length,
    losses: losses.length,
    averageWinEur: average(wins),
    averageLossEur: average(losses),
    largestWinEur: wins.length ? round(Math.max(...wins)) : null,
    largestLossEur: losses.length ? round(Math.min(...losses)) : null,
    netPnlEur: round(pnls.reduce((sum, pnl) => sum + pnl, 0)),
    minimumMeaningfulWinEur: floor,
    warning: microWins.length > 0
      ? `${microWins.length} cierres positivos están por debajo del mínimo económico de ${floor.toFixed(2)} EUR y no deben interpretarse como evidencia de ventaja.`
      : null,
    liveTrading: false,
  };
}
