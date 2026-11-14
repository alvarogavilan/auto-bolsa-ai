import { executionVenue, fetchVenueTickers, type ExecutionVenue } from "./execution-venue";
import type { KrakenTicker } from "./kraken-markets";
import {
  buyAlertText,
  buyExecution,
  planSignalAlerts,
  sellAlertText,
  type PlannedBuyAlert,
  type PlannedSellAlert,
  type SuppressedSignal,
} from "./signal-alerts";
import type { LabAlertView } from "./signal-alerts-lab-view";
import type { SignalAlertLogEntry, SignalAlertState, SignalHolding } from "./signal-alerts-store";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
const RESEARCH_LAB_NAME = "auto-bolsa-ai-research-lab";

function botToken(env: Env): string | null {
  return env.TELEGRAM_BOT_TOKEN?.trim() || env.BETPRO_TELEGRAM_BOT_TOKEN?.trim() || null;
}

function chatId(env: Env): string | null {
  return env.TELEGRAM_CHAT_ID?.trim() || env.BETPRO_TELEGRAM_CHAT_ID?.trim() || null;
}

function bot(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function lab(env: Env): DurableObjectStub {
  return env.RESEARCH_LAB.get(env.RESEARCH_LAB.idFromName(RESEARCH_LAB_NAME));
}

async function postJson<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const response = await stub.fetch(`https://bot${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json<T>();
}

export async function readSignalAlertState(env: Env): Promise<SignalAlertState> {
  const response = await bot(env).fetch("https://bot/signal-alerts/state");
  if (!response.ok) throw new Error(`signal-alerts/state HTTP ${response.status}`);
  return response.json<SignalAlertState>();
}

async function claim(env: Env, key: string): Promise<boolean> {
  const result = await postJson<{ claimed: boolean }>(bot(env), "/signal-alerts/claim", { key });
  return result.claimed === true;
}

async function release(env: Env, key: string): Promise<void> {
  await postJson(bot(env), "/signal-alerts/release", { key });
}

async function commit(env: Env, body: { openHolding?: SignalHolding | null; closeHoldingKey?: string | null; log: SignalAlertLogEntry }): Promise<void> {
  await postJson(bot(env), "/signal-alerts/commit", body);
}

export async function sendTelegramText(env: Env, text: string, venue: ExecutionVenue = executionVenue(env)): Promise<{ ok: boolean; status: number; error?: string }> {
  const token = botToken(env);
  const destination = chatId(env);
  if (!token || !destination) return { ok: false, status: 503, error: "TELEGRAM_NOT_CONFIGURED" };
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: destination,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: `📱 ABRIR ${venue.name.toUpperCase()}`, url: venue.url }]] },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: body.slice(0, 300) || "TELEGRAM_SEND_FAILED" };
  }
  return { ok: true, status: response.status };
}

async function ticker(env: Env, pair: string): Promise<KrakenTicker | null> {
  try {
    return (await fetchVenueTickers(env, [pair]))[pair] ?? null;
  } catch {
    return null;
  }
}

export interface SignalAlertRunResult {
  schemaVersion: "signal-alert-run-v1";
  ranAt: number;
  buysDelivered: string[];
  sellsDelivered: string[];
  failures: string[];
  suppressed: SuppressedSignal[];
  realOrderSubmission: false;
}

async function deliverSell(env: Env, alert: PlannedSellAlert, now: number, result: SignalAlertRunResult): Promise<void> {
  if (!(await claim(env, alert.key))) return;
  const quote = await ticker(env, alert.holding.pair);
  const bid = quote && quote.bid > 0 ? quote.bid : null;
  const sent = await sendTelegramText(env, sellAlertText(alert, bid, executionVenue(env).name)).catch((error: unknown) => ({ ok: false, status: 0, error: String(error) }));
  if (!sent.ok) {
    await release(env, alert.key);
    result.failures.push(`${alert.key}: ${sent.error ?? sent.status}`);
    return;
  }
  await commit(env, {
    closeHoldingKey: alert.holdingKey,
    log: { at: now, key: alert.key, alertId: alert.holding.alertId, kind: "sell", market: alert.holding.market, displayPair: alert.holding.displayPair, delivered: true, suppressed: false, detail: alert.reason },
  });
  result.sellsDelivered.push(alert.key);
}

async function deliverBuy(env: Env, alert: PlannedBuyAlert, now: number, result: SignalAlertRunResult): Promise<void> {
  if (now > alert.expiresAt) return;
  const quote = await ticker(env, alert.pair);
  if (!quote || !(quote.ask > 0) || !(quote.bid > 0) || quote.ask < quote.bid) {
    result.failures.push(`${alert.key}: sin precio verificable en ${executionVenue(env).name} para ${alert.displayPair}`);
    return;
  }
  const spreadPct = (quote.ask - quote.bid) / quote.ask;
  if (spreadPct > 0.01) {
    result.failures.push(`${alert.key}: diferencia compra/venta demasiado alta (${(spreadPct * 100).toFixed(2)} %)`);
    return;
  }
  if (!(await claim(env, alert.key))) return;
  const execution = buyExecution(alert, quote.ask);
  const sent = await sendTelegramText(env, buyAlertText(alert, execution, executionVenue(env).name)).catch((error: unknown) => ({ ok: false, status: 0, error: String(error) }));
  if (!sent.ok) {
    await release(env, alert.key);
    result.failures.push(`${alert.key}: ${sent.error ?? sent.status}`);
    return;
  }
  await commit(env, {
    openHolding: {
      holdingKey: alert.holdingKey,
      alertId: alert.alertId,
      buyKey: alert.key,
      market: alert.market,
      asset: alert.asset,
      pair: alert.pair,
      displayPair: alert.displayPair,
      sourceId: alert.sourceId,
      openedAt: alert.signalAt,
      amountEur: alert.amountEur,
      entryPriceEur: execution.limitPriceEur,
      quantityBase: execution.quantityBase,
    },
    log: { at: now, key: alert.key, alertId: alert.alertId, kind: "buy", market: alert.market, displayPair: alert.displayPair, delivered: true, suppressed: false, detail: alert.reason },
  });
  result.buysDelivered.push(alert.key);
}

async function readJson(stub: DurableObjectStub, url: string): Promise<unknown | null> {
  try {
    const response = await stub.fetch(url);
    return response.ok ? await response.json<unknown>() : null;
  } catch {
    return null;
  }
}

export async function loadSignalInputs(env: Env, options: { includeGold?: boolean; includeCrypto?: boolean } = {}): Promise<{
  state: SignalAlertState;
  xauStatus: unknown | null;
  labView: LabAlertView | null;
}> {
  const [state, xauStatus, labView] = await Promise.all([
    readSignalAlertState(env),
    options.includeGold !== false ? readJson(bot(env), "https://bot/xau/status") : Promise.resolve(null),
    options.includeCrypto !== false ? readJson(lab(env), "https://lab/alerts-view") : Promise.resolve(null),
  ]);
  return { state, xauStatus, labView: labView as LabAlertView | null };
}

/**
 * Ciclo completo: lee estrategias, planifica y entrega alertas COMPRA/VENDE.
 * Las VENDE van primero: salir a tiempo es prioritario sobre entrar.
 */
export async function runSignalAlerts(
  env: Env,
  options: { includeGold?: boolean; includeCrypto?: boolean; now?: number } = {},
): Promise<SignalAlertRunResult> {
  const now = options.now ?? Date.now();
  const result: SignalAlertRunResult = { schemaVersion: "signal-alert-run-v1", ranAt: now, buysDelivered: [], sellsDelivered: [], failures: [], suppressed: [], realOrderSubmission: false };
  if (!botToken(env) || !chatId(env)) {
    result.failures.push("TELEGRAM_NOT_CONFIGURED");
    return result;
  }
  const includeGold = options.includeGold !== false;
  const includeCrypto = options.includeCrypto !== false;
  const { state, xauStatus, labView } = await loadSignalInputs(env, { includeGold, includeCrypto });
  const plan = planSignalAlerts({
    xauStatus,
    lab: labView,
    holdings: state.holdings,
    now,
    includeGold: includeGold && xauStatus !== null,
    includeCrypto: includeCrypto && labView !== null,
  });
  result.suppressed = plan.suppressed;
  for (const sell of plan.sells) await deliverSell(env, sell, now, result);
  for (const buy of plan.buys) await deliverBuy(env, buy, now, result);
  return result;
}
