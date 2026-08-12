export interface XauLiveInstrumentMetadata {
  broker: string;
  symbol: string;
  orderMinBase: number;
  lotDecimals: number;
  priceDecimals: number;
  supportsNativeStop: boolean;
  estimatedRoundTripCostPct: number;
  verifiedAt: number;
}

export interface XauLiveReadinessResult {
  ready: boolean;
  blockers: string[];
}

/**
 * XAU LIVE must never be enabled from a generic trading switch alone.
 * A broker-specific, recently verified gold instrument is mandatory.
 */
export function evaluateXauLiveReadiness(
  metadata: XauLiveInstrumentMetadata | null,
  now = Date.now(),
): XauLiveReadinessResult {
  const blockers: string[] = [];

  if (!metadata) {
    blockers.push("El broker configurado no tiene un instrumento XAU verificado para ejecución LIVE.");
    return { ready: false, blockers };
  }

  if (!metadata.broker.trim()) blockers.push("Broker XAU ausente.");
  if (!metadata.symbol.trim()) blockers.push("Símbolo XAU LIVE ausente.");
  if (!Number.isFinite(metadata.orderMinBase) || metadata.orderMinBase <= 0) blockers.push("Mínimo de orden XAU inválido.");
  if (!Number.isInteger(metadata.lotDecimals) || metadata.lotDecimals < 0) blockers.push("Precisión de volumen XAU inválida.");
  if (!Number.isInteger(metadata.priceDecimals) || metadata.priceDecimals < 0) blockers.push("Precisión de precio XAU inválida.");
  if (!metadata.supportsNativeStop) blockers.push("El instrumento XAU no ofrece stop nativo verificable.");
  if (!Number.isFinite(metadata.estimatedRoundTripCostPct) || metadata.estimatedRoundTripCostPct <= 0) {
    blockers.push("Costes reales XAU no verificados.");
  }
  if (!Number.isFinite(metadata.verifiedAt) || now - metadata.verifiedAt > 24 * 60 * 60 * 1_000) {
    blockers.push("Metadatos XAU LIVE caducados o no verificados en las últimas 24 horas.");
  }

  return { ready: blockers.length === 0, blockers };
}

export const CURRENT_XAU_LIVE_READINESS: XauLiveReadinessResult = evaluateXauLiveReadiness(null);

const MICRO_LIVE_MIN_DECISIONS = 500;
const MICRO_LIVE_MIN_APPROVED_DECISIONS = 20;
const MICRO_LIVE_MIN_CLOSED_TRADES = 2;
const MICRO_LIVE_MAX_DRAWDOWN_PCT = 5;
const MICRO_LIVE_MAX_DECISION_AGE_MS = 3 * 60_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maxDrawdownPct(points: unknown[]): number {
  let peak = 0;
  let max = 0;
  for (const value of points) {
    const point = record(value);
    const equity = finite(point.equityEur, Number.NaN);
    if (!Number.isFinite(equity) || equity <= 0) continue;
    peak = Math.max(peak, equity);
    if (peak > 0) max = Math.max(max, ((peak - equity) / peak) * 100);
  }
  return max;
}

export interface XauMicroLiveReadiness {
  schemaVersion: "xau-micro-live-readiness-v1";
  eligible: boolean;
  fullScaleEligible: false;
  pilotMaximumOrderNotionalEur: 5;
  decisionCycles: number;
  approvedDecisionCycles: number;
  closedTrades: number;
  realizedPnlEur: number;
  equityEur: number;
  initialCapitalEur: number;
  maxObservedDrawdownPct: number;
  latestDecisionAgeMs: number | null;
  latestDecisionOutcome: string | null;
  paperPositionOpen: boolean;
  checks: {
    enoughDecisionHistory: boolean;
    enoughApprovedDecisions: boolean;
    enoughClosedXauTrades: boolean;
    positiveRealizedPnl: boolean;
    capitalPreserved: boolean;
    drawdownAccepted: boolean;
    paperAccountFlat: boolean;
    latestDecisionFresh: boolean;
  };
  blockers: string[];
}

/**
 * Gate independiente para el primer piloto real XAU->PAXG, limitado a 5 EUR.
 * El gate PAPER general se conserva íntegro para cualquier escalado posterior.
 */
export function calculateXauMicroLiveReadiness(
  xauStatus: unknown,
  now = Date.now(),
): XauMicroLiveReadiness {
  const root = record(xauStatus);
  const metrics = record(root.metrics);
  const positionBook = record(root.positionBook ?? root.positions);
  const bookMetrics = record(positionBook.metrics);
  const treasury = record(positionBook.treasury);
  const cycles = Array.isArray(root.cycles) ? root.cycles as unknown[] : [];
  const latestDecision = cycles.find((entry) => {
    const cycle = record(entry);
    const instruction = record(cycle.instruction);
    return instruction.cycleKind !== "monitoring";
  });
  const latest = record(latestDecision);
  const latestObservedAt = finite(latest.observedAt, Number.NaN);
  const latestDecisionAgeMs = Number.isFinite(latestObservedAt)
    ? Math.max(0, now - latestObservedAt)
    : null;

  const decisionCycles = finite(metrics.decisionCycles, finite(metrics.approved) + finite(metrics.blocked));
  const approvedDecisionCycles = finite(metrics.approved);
  const closedTrades = finite(bookMetrics.closed, Array.isArray(positionBook.closed) ? positionBook.closed.length : 0);
  const realizedPnlEur = finite(treasury.realizedPnlEur, finite(bookMetrics.realizedPnlEur));
  const initialCapitalEur = finite(treasury.initialCapitalEur, 100);
  const equityEur = finite(treasury.equityEur, initialCapitalEur + realizedPnlEur);
  const equityCurve = Array.isArray(treasury.equityCurve) ? treasury.equityCurve : [];
  const drawdown = maxDrawdownPct(equityCurve);
  const paperPositionOpen = Boolean(positionBook.open);

  const checks = {
    enoughDecisionHistory: decisionCycles >= MICRO_LIVE_MIN_DECISIONS,
    enoughApprovedDecisions: approvedDecisionCycles >= MICRO_LIVE_MIN_APPROVED_DECISIONS,
    enoughClosedXauTrades: closedTrades >= MICRO_LIVE_MIN_CLOSED_TRADES,
    positiveRealizedPnl: realizedPnlEur > 0,
    capitalPreserved: equityEur >= initialCapitalEur,
    drawdownAccepted: drawdown <= MICRO_LIVE_MAX_DRAWDOWN_PCT,
    paperAccountFlat: !paperPositionOpen,
    latestDecisionFresh: latestDecisionAgeMs !== null && latestDecisionAgeMs <= MICRO_LIVE_MAX_DECISION_AGE_MS,
  };

  const blockers: string[] = [];
  if (!checks.enoughDecisionHistory) blockers.push(`XAU necesita al menos ${MICRO_LIVE_MIN_DECISIONS} ciclos de decisión observados`);
  if (!checks.enoughApprovedDecisions) blockers.push(`XAU necesita al menos ${MICRO_LIVE_MIN_APPROVED_DECISIONS} decisiones aprobadas observadas`);
  if (!checks.enoughClosedXauTrades) blockers.push(`XAU necesita al menos ${MICRO_LIVE_MIN_CLOSED_TRADES} cierres PAPER propios`);
  if (!checks.positiveRealizedPnl) blockers.push("El PnL realizado XAU PAPER debe ser positivo");
  if (!checks.capitalPreserved) blockers.push("La equity XAU PAPER debe conservar al menos el capital inicial");
  if (!checks.drawdownAccepted) blockers.push(`El drawdown XAU PAPER supera ${MICRO_LIVE_MAX_DRAWDOWN_PCT}%`);
  if (!checks.paperAccountFlat) blockers.push("Debe cerrarse cualquier posición XAU PAPER antes de armar el piloto real");
  if (!checks.latestDecisionFresh) blockers.push("La decisión XAU más reciente no está dentro de la ventana de 3 minutos");

  return {
    schemaVersion: "xau-micro-live-readiness-v1",
    eligible: blockers.length === 0,
    fullScaleEligible: false,
    pilotMaximumOrderNotionalEur: 5,
    decisionCycles,
    approvedDecisionCycles,
    closedTrades,
    realizedPnlEur,
    equityEur,
    initialCapitalEur,
    maxObservedDrawdownPct: Math.round(drawdown * 1_000) / 1_000,
    latestDecisionAgeMs,
    latestDecisionOutcome: typeof latest.outcome === "string" ? latest.outcome : null,
    paperPositionOpen,
    checks,
    blockers,
  };
}
