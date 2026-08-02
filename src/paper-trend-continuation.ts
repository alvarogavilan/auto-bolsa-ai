import { interpretChart } from "./chart-intelligence";
import type { NewsDecisionContext } from "./news-decision-context";
import type { FastEntryGate, LabStrategyState, LabTrade } from "./research-lab";
import type { Candle } from "./types";

export interface TrendContinuationResult {
  entered: boolean;
  blocker: string | null;
  liveTrading: false;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function laneAllocationPct(strategy: LabStrategyState): number {
  if (strategy.lane === "fast") return 0.06;
  if (strategy.lane === "intraday") return 0.08;
  return 0.1;
}

function executionBlocker(strategy: LabStrategyState, gate: FastEntryGate | null, now: number): string | null {
  if (strategy.lane !== "fast") return null;
  if (!gate) return "evidencia de ejecución rápida no disponible";
  if (now - gate.checkedAt > 10 * 60_000) return "evidencia de ejecución rápida caducada";
  if (!gate.allowed) return gate.blocker ?? "coste o profundidad insuficientes";
  return null;
}

export function applyPaperTrendContinuationEntry(
  strategy: LabStrategyState,
  candles: Candle[],
  now: number,
  fastEntryGate: FastEntryGate | null,
  news: NewsDecisionContext | null,
): TrendContinuationResult {
  if (strategy.position) return { entered: false, blocker: "posición ya abierta", liveTrading: false };
  if (strategy.status !== "active") return { entered: false, blocker: "estrategia no activa", liveTrading: false };
  if (strategy.lastDecision !== "Sin señal válida para el carril") {
    return { entered: false, blocker: "la vía EMA principal no terminó en espera", liveTrading: false };
  }
  if (strategy.lastTradeAt !== null && now - strategy.lastTradeAt < strategy.config.cooldownMinutes * 60_000) {
    return { entered: false, blocker: "cooldown PAPER", liveTrading: false };
  }

  const gateBlocker = executionBlocker(strategy, fastEntryGate, now);
  if (gateBlocker) return { entered: false, blocker: gateBlocker, liveTrading: false };
  if (news?.vetoNewLong) return { entered: false, blocker: "veto del departamento de noticias", liveTrading: false };

  const chart = interpretChart(candles);
  if (chart.vetoNewLong || chart.regime !== "trend" || chart.trend !== "bullish") {
    return { entered: false, blocker: `gráfica ${chart.regime}/${chart.trend}`, liveTrading: false };
  }
  if (chart.timeframeAgreementPct < 0.75 || chart.confidence < 0.68 || chart.momentum <= 0.0012) {
    return { entered: false, blocker: "continuidad multitemporal insuficiente", liveTrading: false };
  }
  if (!chart.breakoutConfirmed && chart.confidence < 0.78) {
    return { entered: false, blocker: "sin ruptura ni confianza reforzada", liveTrading: false };
  }

  const costCoverage = strategy.estimatedTakerRoundTripCostPct / Math.max(strategy.config.takeProfitPct, 0.0001);
  if (costCoverage > 0.45) return { entered: false, blocker: "costes excesivos frente al objetivo", liveTrading: false };

  const currentPrice = candles.at(-1)?.close;
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { entered: false, blocker: "precio actual no disponible", liveTrading: false };
  }

  const grossBudget = Math.min(5, strategy.cashEur * laneAllocationPct(strategy));
  if (grossBudget < strategy.estimatedOrderMinimumEur) {
    return { entered: false, blocker: "mínimo del mercado superior al presupuesto conservador", liveTrading: false };
  }
  const price = currentPrice * (1 + strategy.config.slippagePctEachSide);
  const feeEur = grossBudget * strategy.config.feePctEachSide;
  const totalCost = grossBudget + feeEur;
  if (totalCost > strategy.cashEur) return { entered: false, blocker: "saldo PAPER insuficiente", liveTrading: false };

  const quantity = grossBudget / price;
  const reason = `Continuación alcista multitemporal: consenso ${(chart.timeframeAgreementPct * 100).toFixed(0)} %, confianza ${(chart.confidence * 100).toFixed(0)} %, momentum ${(chart.momentum * 100).toFixed(3)} %`;
  strategy.cashEur = money(strategy.cashEur - totalCost);
  strategy.position = {
    quantity,
    entryPrice: price,
    entryTime: now,
    costEur: totalCost,
    stopLoss: price * (1 - strategy.config.stopLossPct),
    takeProfit: price * (1 + strategy.config.takeProfitPct),
  };
  strategy.lastTradeAt = now;
  strategy.lastDecision = `PAPER BUY: ${reason}`;
  strategy.performance.buys += 1;
  strategy.performance.totalFeesEur = money(strategy.performance.totalFeesEur + feeEur);
  const trade: LabTrade = {
    id: crypto.randomUUID(),
    side: "buy",
    timestamp: now,
    price,
    quantity,
    grossEur: grossBudget,
    feeEur,
    reason,
  };
  strategy.trades = [trade, ...strategy.trades].slice(0, 100);
  strategy.equityEur = money(strategy.cashEur + quantity * currentPrice);

  return { entered: true, blocker: null, liveTrading: false };
}
