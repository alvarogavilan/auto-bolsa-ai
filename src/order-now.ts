import type { KrakenTicker } from "./kraken-markets";
import {
  BUY_LIMIT_BUFFER_PCT,
  CRYPTO_BUY_WINDOW_MS,
  GOLD_BUY_WINDOW_MS,
  buyExecution,
  ceilToDecimals,
  formatEurPrice,
  priceDecimals,
  type SignalAlertPlan,
} from "./signal-alerts";
import type { SignalHolding } from "./signal-alerts-store";

/**
 * «Orden ahora»: la única instrucción que el usuario debe ejecutar en este
 * instante. Se recalcula en cada petición con el precio vivo de la plataforma de ejecución.
 *
 * Prioridad: VENDE > COMPRA > MANTÉN > ESPERA.
 */

/** Si la última decisión del motor es más vieja que esto, no se muestra ninguna compra. */
export const ENGINE_STALE_MS = 6 * 60_000;
/** Si el precio ya superó el límite original en más de esto, la compra se anula. */
export const PRICE_ESCAPED_PCT = 0.003;

export type OrderAction = "buy" | "sell" | "hold" | "wait";

export interface OrderCard {
  action: OrderAction;
  headline: string;
  asset: string | null;
  displayPair: string | null;
  alertId: string | null;
  steps: string[];
  warnings: string[];
  reason: string | null;
  evidence: string | null;
  expiresAt: number | null;
  priceEur: number | null;
  resultPct: number | null;
}

export interface TeamVote {
  expert: string;
  bias: "long" | "short" | "neutral";
  confidence: number;
  reason: string;
}

export interface OrderNowPayload {
  schemaVersion: "order-now-v1";
  generatedAt: number;
  dataFresh: boolean;
  staleReason: string | null;
  latestDecisionAt: number | null;
  primary: OrderCard;
  others: OrderCard[];
  team: { market: "ORO (XAU/USD)"; bias: string; consensusPct: number; votes: TeamVote[]; vetoes: string[] } | null;
  market: Array<{ label: string; bidEur: number; askEur: number; change24hPct: number | null }>;
  discarded: string[];
  venue: { name: string; url: string };
  realOrderSubmission: false;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizePair(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const PAIR_ALIASES: Record<string, string[]> = {
  XBTEUR: ["XXBTZEUR"],
  ETHEUR: ["XETHZEUR"],
};

export function findTicker(tickers: Record<string, KrakenTicker>, pair: string): KrakenTicker | null {
  const wanted = normalizePair(pair);
  const accepted = new Set([wanted, ...(PAIR_ALIASES[wanted] ?? [])]);
  for (const [key, ticker] of Object.entries(tickers)) {
    const normalized = normalizePair(key);
    if (accepted.has(normalized) || (PAIR_ALIASES[normalized] ?? []).includes(wanted)) return ticker;
  }
  return null;
}

function unit(holding: { market: string; asset: string }): string {
  return holding.market === "gold" ? "PAXG" : holding.asset;
}

function amount(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function buyCard(input: {
  venueName: string;
  asset: string;
  displayPair: string;
  alertId: string;
  amountEur: number;
  limitPriceEur: number;
  quantityBase: number;
  unit: string;
  expiresAt: number;
  reason: string | null;
  evidence: string | null;
  stopEur: number | null;
  targetEur: number | null;
}): OrderCard {
  const decimals = priceDecimals(input.limitPriceEur);
  return {
    action: "buy",
    headline: `COMPRA AHORA · ${input.asset}`,
    asset: input.asset,
    displayPair: input.displayPair,
    alertId: input.alertId,
    steps: [
      `Abre ${input.venueName} y busca ${input.displayPair}`,
      "Pulsa Comprar → tipo de orden «Límite»",
      `Precio límite: ${formatEurPrice(input.limitPriceEur, decimals)}`,
      `Importe: ${amount(input.amountEur)} (≈ ${input.quantityBase.toFixed(8)} ${input.unit})`,
      "Confirma la orden",
    ],
    warnings: [
      "Si la cuenta atrás llega a cero, NO compres.",
      "Si la orden no se completa en 10 minutos, cancélala.",
      "Sin orden límite en tu app: compra solo si el precio mostrado es ese o menor.",
      "Si ya compraste con esta alerta, no compres otra vez.",
    ],
    reason: input.reason,
    evidence: input.evidence
      ? `${input.evidence}${input.stopEur !== null ? ` · protección ≈ ${formatEurPrice(input.stopEur, decimals)}` : ""}${input.targetEur !== null ? ` · objetivo ≈ ${formatEurPrice(input.targetEur, decimals)}` : ""}`
      : null,
    expiresAt: input.expiresAt,
    priceEur: input.limitPriceEur,
    resultPct: null,
  };
}

function waitCard(headline: string, reason: string | null): OrderCard {
  return {
    action: "wait",
    headline,
    asset: null,
    displayPair: null,
    alertId: null,
    steps: ["No compres ni vendas nada.", "Esta pantalla y Telegram te avisarán cuando haya una orden."],
    warnings: [],
    reason,
    evidence: null,
    expiresAt: null,
    priceEur: null,
    resultPct: null,
  };
}

function latestDecision(xauStatus: unknown): Record<string, unknown> | null {
  const cycles = Array.isArray(record(xauStatus).cycles) ? record(xauStatus).cycles as unknown[] : [];
  for (const entry of cycles) {
    const cycle = record(entry);
    if (record(cycle.instruction).cycleKind !== "monitoring") return cycle;
  }
  return null;
}

export function buildOrderNow(input: {
  now: number;
  xauStatus: unknown | null;
  holdings: Record<string, SignalHolding>;
  plan: SignalAlertPlan;
  tickers: Record<string, KrakenTicker>;
  tickersAvailable: boolean;
  venue?: { name: string; url: string };
}): OrderNowPayload {
  const venue = input.venue ?? { name: "Crypto.com", url: "https://crypto.com/exchange/" };
  const { now, plan, tickers } = input;
  const cards: OrderCard[] = [];
  const discarded: string[] = plan.suppressed.map((item) => `${item.displayPair}: señal descartada — ${item.reason}`);

  const decision = latestDecision(input.xauStatus);
  const latestDecisionAt = typeof decision?.observedAt === "number" ? decision.observedAt : null;
  const engineStale = latestDecisionAt === null || now - latestDecisionAt > ENGINE_STALE_MS;
  const staleReason = input.xauStatus === null
    ? "No se pudo leer el estado del motor."
    : engineStale
      ? "El motor de análisis lleva más de 6 minutos sin decidir."
      : !input.tickersAvailable
        ? `No hay precio en vivo de ${venue.name}.`
        : null;
  const dataFresh = staleReason === null;

  // 1. VENDE: siempre primero y nunca se oculta, aunque los datos estén viejos.
  const sellingKeys = new Set<string>();
  for (const sell of plan.sells) {
    sellingKeys.add(sell.holdingKey);
    const holding = sell.holding;
    const quote = findTicker(tickers, holding.pair);
    const bid = quote && quote.bid > 0 ? quote.bid : null;
    cards.push({
      action: "sell",
      headline: `VENDE AHORA · ${holding.asset}`,
      asset: holding.asset,
      displayPair: holding.displayPair,
      alertId: holding.alertId,
      steps: [
        `Abre ${venue.name} y busca ${holding.displayPair}`,
        "Pulsa Vender → tipo de orden «Mercado»",
        `Cantidad: TODO lo comprado con la alerta ${holding.alertId} (≈ ${holding.quantityBase.toFixed(8)} ${unit(holding)})`,
        "Confirma la orden",
      ],
      warnings: ["Hazlo aunque vaya en pérdidas: es la regla de protección.", "Si no compraste con esa alerta, ignóralo."],
      reason: sell.reason,
      evidence: null,
      expiresAt: null,
      priceEur: bid,
      resultPct: bid !== null && holding.entryPriceEur > 0 ? ((bid - holding.entryPriceEur) / holding.entryPriceEur) * 100 : sell.simulatedResultPct,
    });
  }

  // 2. COMPRA nueva (aún no enviada por Telegram).
  if (dataFresh) {
    for (const buy of plan.buys) {
      if (now > buy.expiresAt) continue;
      const quote = findTicker(tickers, buy.pair);
      if (!quote || !(quote.ask > 0)) continue;
      const execution = buyExecution(buy, quote.ask);
      cards.push(buyCard({
        venueName: venue.name,
        asset: buy.asset,
        displayPair: buy.displayPair,
        alertId: buy.alertId,
        amountEur: buy.amountEur,
        limitPriceEur: execution.limitPriceEur,
        quantityBase: execution.quantityBase,
        unit: unit(buy),
        expiresAt: buy.expiresAt,
        reason: buy.reason,
        evidence: buy.evidence,
        stopEur: execution.stopPriceEur,
        targetEur: execution.targetPriceEur,
      }));
    }
  }

  // 3. Posiciones ya avisadas: COMPRA (si sigue en ventana y el precio no se escapó) o MANTÉN.
  for (const holding of Object.values(input.holdings)) {
    if (sellingKeys.has(holding.holdingKey)) continue;
    const window = holding.market === "gold" ? GOLD_BUY_WINDOW_MS : CRYPTO_BUY_WINDOW_MS;
    const expiresAt = holding.openedAt + window;
    const quote = findTicker(tickers, holding.pair);
    const escaped = quote ? quote.ask > holding.entryPriceEur * (1 + PRICE_ESCAPED_PCT) : true;
    if (dataFresh && now <= expiresAt && quote && !escaped) {
      const limit = Math.min(holding.entryPriceEur, ceilToDecimals(quote.ask * (1 + BUY_LIMIT_BUFFER_PCT), priceDecimals(quote.ask)));
      cards.push(buyCard({
        venueName: venue.name,
        asset: holding.asset,
        displayPair: holding.displayPair,
        alertId: holding.alertId,
        amountEur: holding.amountEur,
        limitPriceEur: limit,
        quantityBase: holding.amountEur / limit,
        unit: unit(holding),
        expiresAt,
        reason: "Orden ya enviada por Telegram. Ejecútala solo si aún no lo has hecho.",
        evidence: null,
        stopEur: null,
        targetEur: null,
      }));
      continue;
    }
    const bid = quote && quote.bid > 0 ? quote.bid : null;
    cards.push({
      action: "hold",
      headline: `MANTÉN · ${holding.asset}`,
      asset: holding.asset,
      displayPair: holding.displayPair,
      alertId: holding.alertId,
      steps: [
        `Si compraste con la alerta ${holding.alertId}: no hagas nada.`,
        "Recibirás «VENDE AHORA» aquí y en Telegram cuando toque salir.",
        "Si NO llegaste a comprar: no compres ahora, la señal ya caducó.",
      ],
      warnings: [],
      reason: null,
      evidence: null,
      expiresAt: null,
      priceEur: bid,
      resultPct: bid !== null && holding.entryPriceEur > 0 ? ((bid - holding.entryPriceEur) / holding.entryPriceEur) * 100 : null,
    });
  }

  const instruction = record(decision?.instruction);
  const cabinet = record(instruction.cabinetDecision);
  const votes = Array.isArray(cabinet.votes) ? cabinet.votes.map(record) : [];
  const vetoes = Array.isArray(cabinet.vetoes) ? cabinet.vetoes.filter((item): item is string => typeof item === "string") : [];
  const team = votes.length > 0
    ? {
      market: "ORO (XAU/USD)" as const,
      bias: typeof cabinet.bias === "string" ? cabinet.bias : "neutral",
      consensusPct: typeof cabinet.consensusPct === "number" ? cabinet.consensusPct : 0,
      votes: votes.map((vote): TeamVote => ({
        expert: String(vote.expert ?? ""),
        bias: vote.bias === "long" || vote.bias === "short" ? vote.bias : "neutral",
        confidence: typeof vote.confidence === "number" ? vote.confidence : 0,
        reason: String(vote.reason ?? ""),
      })),
      vetoes,
    }
    : null;

  if (cards.length === 0) {
    cards.push(dataFresh
      ? waitCard("ESPERA · no hay orden", vetoes[0] ?? "Ninguna estrategia con historial ganador ha abierto posición.")
      : waitCard("NO OPERES · datos no actualizados", staleReason));
  }

  const order: Record<OrderAction, number> = { sell: 0, buy: 1, hold: 2, wait: 3 };
  cards.sort((left, right) => order[left.action] - order[right.action]);

  const market: OrderNowPayload["market"] = [];
  for (const [label, pair] of [["Oro · PAXG/EUR", "PAXGEUR"], ["Bitcoin · BTC/EUR", "XBTEUR"], ["Ethereum · ETH/EUR", "ETHEUR"]] as const) {
    const quote = findTicker(tickers, pair);
    if (!quote || !(quote.bid > 0)) continue;
    market.push({ label, bidEur: quote.bid, askEur: quote.ask, change24hPct: quote.open24h > 0 ? ((quote.last - quote.open24h) / quote.open24h) * 100 : null });
  }

  return {
    schemaVersion: "order-now-v1",
    generatedAt: now,
    dataFresh,
    staleReason,
    latestDecisionAt,
    primary: cards[0] as OrderCard,
    others: cards.slice(1),
    team,
    market,
    discarded,
    venue,
    realOrderSubmission: false,
  };
}
