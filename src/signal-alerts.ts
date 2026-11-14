import { calculateXauMicroLiveReadiness } from "./xau-live-readiness";
import type { LabAlertView } from "./signal-alerts-lab-view";
import type { SignalHolding } from "./signal-alerts-store";
import { buySteps, sellSteps } from "./order-steps";

/**
 * Motor de alertas COMPRA AHORA / VENDE AHORA para ejecución manual.
 *
 * Reglas (sin margen para la improvisación):
 * 1. Una COMPRA solo nace de la APERTURA real de una posición simulada de la
 *    estrategia (no de cada ciclo de análisis) y solo si la estrategia tiene
 *    historial simulado suficiente y positivo.
 * 2. Una COMPRA caduca: si no se entrega en su ventana, no se envía tarde.
 * 3. Una VENDE solo se envía para algo que antes se mandó COMPRAR, y se envía
 *    siempre (sin caducidad) cuando la estrategia cierra esa posición.
 * 4. Nunca se pide vender en corto: las señales bajistas sin inventario se
 *    ignoran porque en mercado al contado no se puede vender lo que no se tiene.
 * 5. Como máximo una posición de oro y una de crypto abiertas a la vez.
 */

export const GOLD_HOLDING_KEY = "gold";
export const GOLD_PAIR = "PAXGEUR";
export const GOLD_BUY_WINDOW_MS = 10 * 60_000;
export const CRYPTO_BUY_WINDOW_MS = 15 * 60_000;
export const GOLD_MIN_CLOSED_TRADES = 10;
export const MAX_CRYPTO_HOLDINGS = 1;
/** Margen sobre el ask para que la orden límite se ejecute al momento. */
export const BUY_LIMIT_BUFFER_PCT = 0.002;

export interface PlannedBuyAlert {
  kind: "buy";
  key: string;
  holdingKey: string;
  alertId: string;
  market: "gold" | "crypto";
  asset: string;
  pair: string;
  displayPair: string;
  sourceId: string;
  amountEur: number;
  signalAt: number;
  expiresAt: number;
  /** Distancia relativa del stop/objetivo respecto a la entrada de la señal. */
  stopRatio: number | null;
  targetRatio: number | null;
  reason: string;
  evidence: string;
}

export interface PlannedSellAlert {
  kind: "sell";
  key: string;
  holdingKey: string;
  holding: SignalHolding;
  reason: string;
  simulatedResultPct: number | null;
}

export interface SuppressedSignal {
  key: string;
  market: "gold" | "crypto";
  displayPair: string;
  reason: string;
}

export interface SignalAlertPlan {
  buys: PlannedBuyAlert[];
  sells: PlannedSellAlert[];
  suppressed: SuppressedSignal[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortId(prefix: string, raw: string): string {
  let hash = 0;
  for (const char of raw) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${prefix}-${hash.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} %`;
}

function eur(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} €`;
}

export interface GoldEvidence {
  ok: boolean;
  closedTrades: number;
  realizedPnlEur: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  blockers: string[];
  summary: string;
}

export function evaluateGoldEvidence(xauStatus: unknown, now: number): GoldEvidence {
  const readiness = calculateXauMicroLiveReadiness(xauStatus, now);
  const book = record(record(xauStatus).positionBook);
  const metrics = record(book.metrics);
  const winners = finite(metrics.winners) ?? 0;
  const winRatePct = readiness.closedTrades > 0 ? (winners / readiness.closedTrades) * 100 : null;
  const blockers: string[] = [];
  if (readiness.closedTrades < GOLD_MIN_CLOSED_TRADES) blockers.push(`historial insuficiente: ${readiness.closedTrades}/${GOLD_MIN_CLOSED_TRADES} operaciones simuladas cerradas`);
  if (!readiness.checks.positiveRealizedPnl) blockers.push("resultado simulado acumulado no positivo");
  if (!readiness.checks.capitalPreserved) blockers.push("el capital simulado está por debajo del inicial");
  if (!readiness.checks.drawdownAccepted) blockers.push("caída máxima simulada superior al 5 %");
  const summary = `${readiness.closedTrades} operaciones · ${eur(readiness.realizedPnlEur)} · ${winRatePct === null ? "—" : `${Math.round(winRatePct)} %`} aciertos · caída máx. ${readiness.maxObservedDrawdownPct.toFixed(1).replace(".", ",")} %`;
  return {
    ok: blockers.length === 0,
    closedTrades: readiness.closedTrades,
    realizedPnlEur: readiness.realizedPnlEur,
    maxDrawdownPct: readiness.maxObservedDrawdownPct,
    winRatePct,
    blockers,
    summary,
  };
}

function planGold(xauStatus: unknown, holdings: Record<string, SignalHolding>, now: number, plan: SignalAlertPlan): void {
  const book = record(record(xauStatus).positionBook);
  const open = record(book.open);
  const openId = typeof open.id === "string" ? open.id : null;
  const holding = holdings[GOLD_HOLDING_KEY];

  if (holding) {
    // Seguimos dentro de la misma posición: no hay nada que hacer.
    if (openId !== null && holding.sourceId === openId) return;
    const closed = (Array.isArray(book.closed) ? book.closed : []).map(record).find((entry) => entry.id === holding.sourceId);
    const entry = finite(closed?.entryPrice);
    const exit = finite(closed?.exitPrice);
    const trailing = closed?.trailingActive === true;
    plan.sells.push({
      kind: "sell",
      key: `gold:sell:${holding.sourceId}`,
      holdingKey: GOLD_HOLDING_KEY,
      holding,
      reason: closed
        ? trailing
          ? "Se ha activado el stop que protege la ganancia."
          : "El precio ha tocado el stop de protección. Salir ahora limita la pérdida."
        : "La estrategia ha cerrado la posición.",
      simulatedResultPct: entry && exit ? ((exit - entry) / entry) * 100 : null,
    });
    return;
  }

  if (!openId || open.side !== "buy") return;
  const openedAt = finite(open.openedAt);
  const entry = finite(open.entryPrice);
  const budget = finite(open.budgetEur);
  if (openedAt === null || entry === null || entry <= 0 || budget === null || budget <= 0) return;
  if (now - openedAt > GOLD_BUY_WINDOW_MS) return;

  const key = `gold:buy:${openId}`;
  const evidence = evaluateGoldEvidence(xauStatus, now);
  if (!evidence.ok) {
    plan.suppressed.push({ key, market: "gold", displayPair: "PAXG/EUR", reason: evidence.blockers.join("; ") });
    return;
  }
  const stop = finite(open.initialStopPrice ?? open.stopPrice);
  const target = finite(open.targetPrice);
  plan.buys.push({
    kind: "buy",
    key,
    holdingKey: GOLD_HOLDING_KEY,
    alertId: shortId("ORO", openId),
    market: "gold",
    asset: "ORO (PAXG)",
    pair: GOLD_PAIR,
    displayPair: "PAXG/EUR",
    sourceId: openId,
    amountEur: Math.round(budget * 100) / 100,
    signalAt: openedAt,
    expiresAt: openedAt + GOLD_BUY_WINDOW_MS,
    stopRatio: stop !== null ? stop / entry : null,
    targetRatio: target !== null ? target / entry : null,
    reason: "Consenso técnico y macro alcista en oro (XAU/USD).",
    evidence: evidence.summary,
  });
}

function planCrypto(lab: LabAlertView | null, holdings: Record<string, SignalHolding>, now: number, plan: SignalAlertPlan): void {
  if (!lab || !lab.initialized) return;
  const byId = new Map(lab.strategies.map((strategy) => [strategy.id, strategy]));

  const cryptoHoldings = Object.values(holdings).filter((holding) => holding.market === "crypto");
  for (const holding of cryptoHoldings) {
    const strategy = byId.get(holding.sourceId);
    const stillOpen = strategy?.position && strategy.position.entryTime === holding.openedAt;
    if (stillOpen) continue;
    const exitTrade = strategy?.recentTrades.find((trade) => trade.side === "sell" && trade.timestamp >= holding.openedAt) ?? null;
    plan.sells.push({
      kind: "sell",
      key: `crypto:sell:${holding.sourceId}:${holding.openedAt}`,
      holdingKey: holding.holdingKey,
      holding,
      reason: exitTrade ? `${exitTrade.reason}.` : "La estrategia ha cerrado la posición.",
      simulatedResultPct: exitTrade && holding.entryPriceEur > 0
        ? ((exitTrade.price - holding.entryPriceEur) / holding.entryPriceEur) * 100
        : null,
    });
  }

  const remainingAfterSells = cryptoHoldings.length - plan.sells.filter((sell) => sell.holding.market === "crypto").length;
  let capacity = MAX_CRYPTO_HOLDINGS - remainingAfterSells;
  if (capacity <= 0) return;
  const heldBases = new Set(cryptoHoldings.map((holding) => holding.asset));

  const candidates = lab.strategies
    .filter((strategy) => strategy.status === "active" && strategy.position !== null)
    .map((strategy) => ({ strategy, buy: strategy.recentTrades[0] }))
    .filter(({ strategy, buy }) => buy?.side === "buy" && buy.timestamp === strategy.position?.entryTime && now - buy.timestamp <= CRYPTO_BUY_WINDOW_MS)
    .sort((left, right) => (right.strategy.profitFactor ?? 0) - (left.strategy.profitFactor ?? 0));

  for (const { strategy, buy } of candidates) {
    if (capacity <= 0 || !buy || !strategy.position) break;
    const key = `crypto:buy:${buy.id}`;
    const displayPair = `${strategy.base}/EUR`;
    if (!strategy.eligibleForHumanReview) {
      plan.suppressed.push({ key, market: "crypto", displayPair, reason: `estrategia ${strategy.id} sin evidencia suficiente (≥30 cierres, 14 días, PF ≥ 1,1, caída ≤ 5 %)` });
      continue;
    }
    if (heldBases.has(strategy.base)) continue;
    const entry = strategy.position.entryPrice;
    plan.buys.push({
      kind: "buy",
      key,
      holdingKey: `crypto:${strategy.id}`,
      alertId: shortId(strategy.base.slice(0, 4).toUpperCase(), buy.id),
      market: "crypto",
      asset: strategy.base,
      pair: strategy.pairKey,
      displayPair,
      sourceId: strategy.id,
      amountEur: Math.round(buy.grossEur * 100) / 100,
      signalAt: buy.timestamp,
      expiresAt: buy.timestamp + CRYPTO_BUY_WINDOW_MS,
      stopRatio: entry > 0 ? strategy.position.stopLoss / entry : null,
      targetRatio: entry > 0 ? strategy.position.takeProfit / entry : null,
      reason: `${buy.reason}.`,
      evidence: `${strategy.closedTrades} operaciones · ${eur(strategy.netPnlEur)} · ${strategy.winRatePct === null ? "—" : `${Math.round(strategy.winRatePct)} %`} aciertos · caída máx. ${(strategy.maxDrawdownPct * 100).toFixed(1).replace(".", ",")} %`,
    });
    heldBases.add(strategy.base);
    capacity -= 1;
  }
}

export function planSignalAlerts(input: {
  xauStatus: unknown | null;
  lab: LabAlertView | null;
  holdings: Record<string, SignalHolding>;
  now: number;
  includeGold?: boolean;
  includeCrypto?: boolean;
}): SignalAlertPlan {
  const plan: SignalAlertPlan = { buys: [], sells: [], suppressed: [] };
  if (input.includeGold !== false && input.xauStatus) planGold(input.xauStatus, input.holdings, input.now, plan);
  if (input.includeCrypto !== false) planCrypto(input.lab, input.holdings, input.now, plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

export function priceDecimals(price: number): number {
  if (price >= 1_000) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.01) return 6;
  return 8;
}

export function formatEurPrice(price: number, decimals = priceDecimals(price)): string {
  const [integer, fraction] = price.toFixed(decimals).split(".");
  const grouped = (integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped}${fraction ? `,${fraction}` : ""} €`;
}

function madridTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
}

export function ceilToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - 1e-9) / factor;
}

export interface BuyExecution {
  limitPriceEur: number;
  quantityBase: number;
  stopPriceEur: number | null;
  targetPriceEur: number | null;
}

export function buyExecution(alert: PlannedBuyAlert, askEur: number): BuyExecution {
  const decimals = priceDecimals(askEur);
  const limitPriceEur = ceilToDecimals(askEur * (1 + BUY_LIMIT_BUFFER_PCT), decimals);
  return {
    limitPriceEur,
    quantityBase: alert.amountEur / limitPriceEur,
    stopPriceEur: alert.stopRatio !== null ? askEur * alert.stopRatio : null,
    targetPriceEur: alert.targetRatio !== null ? askEur * alert.targetRatio : null,
  };
}

export function buyAlertText(alert: PlannedBuyAlert, execution: BuyExecution, venueName = "Crypto.com"): string {
  const decimals = priceDecimals(execution.limitPriceEur);
  return [
    `🟢 COMPRA AHORA · ${alert.asset}`,
    "",
    `Qué hacer (en ${venueName}):`,
    ...buySteps({ market: alert.market, asset: alert.asset, amountEur: alert.amountEur, maxPriceText: formatEurPrice(execution.limitPriceEur, decimals) }).map((step, index) => `${index + 1}. ${step}.`),
    "",
    "⛔ NO compres si:",
    `• lees esto después de las ${madridTime(alert.expiresAt)} (la señal caduca)`,
    "• el precio que te muestra la app es mayor que el precio máximo del paso 4",
    "• ya compraste con esta alerta",
    "",
    "Después: no hagas nada. Recibirás «🔴 VENDE AHORA» cuando toque salir.",
    execution.stopPriceEur !== null || execution.targetPriceEur !== null
      ? `Referencia: protección ≈ ${execution.stopPriceEur !== null ? formatEurPrice(execution.stopPriceEur, decimals) : "—"} · objetivo ≈ ${execution.targetPriceEur !== null ? formatEurPrice(execution.targetPriceEur, decimals) : "—"}`
      : null,
    "",
    `Motivo: ${alert.reason}`,
    `Historial simulado de la estrategia: ${alert.evidence}`,
    `Alerta ${alert.alertId} · ${madridTime(alert.signalAt)}`,
    "",
    "Auto Bolsa NO ha enviado ninguna orden: la ejecutas tú. Señal basada en simulación; no es garantía de beneficio.",
  ].filter((line): line is string => line !== null).join("\n");
}

export function sellAlertText(alert: PlannedSellAlert, bidEur: number | null, venueName = "Crypto.com"): string {
  const holding = alert.holding;
  const result = bidEur !== null && holding.entryPriceEur > 0
    ? ((bidEur - holding.entryPriceEur) / holding.entryPriceEur) * 100
    : alert.simulatedResultPct;
  return [
    `🔴 VENDE AHORA · ${holding.asset}`,
    "",
    `Qué hacer (en ${venueName}):`,
    ...sellSteps({ market: holding.market, asset: holding.asset, alertId: holding.alertId, quantityBase: holding.quantityBase }).map((step, index) => `${index + 1}. ${step}.`),
    "",
    "Hazlo aunque vaya en pérdidas: es la regla de protección. No esperes a que «se recupere».",
    "Si no compraste con esa alerta, ignora este mensaje.",
    "",
    `Motivo: ${alert.reason}`,
    bidEur !== null ? `Precio actual aproximado: ${formatEurPrice(bidEur)}` : null,
    result !== null ? `Resultado aproximado: ${pct(result)} (antes de comisiones)` : null,
    "",
    "Auto Bolsa NO ha enviado ninguna orden: la ejecutas tú.",
  ].filter((line): line is string => line !== null).join("\n");
}
