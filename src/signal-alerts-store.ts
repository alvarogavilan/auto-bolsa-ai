/**
 * Estado persistente del motor de alertas COMPRA/VENDE.
 *
 * - `sent`: claves de alerta ya reclamadas/enviadas (deduplicación).
 * - `holdings`: lo que el usuario debería tener comprado según las alertas
 *   COMPRA entregadas. Cada COMPRA abre un holding y la VENDE asociada lo
 *   cierra, de modo que nunca se pide vender algo que no se mandó comprar.
 */
export const SIGNAL_ALERT_STATE_KEY = "signal-alerts:v1";
const MAX_SENT_KEYS = 500;
const MAX_LOG_ENTRIES = 60;

export interface SignalHolding {
  holdingKey: string;
  alertId: string;
  buyKey: string;
  market: "gold" | "crypto";
  asset: string;
  pair: string;
  displayPair: string;
  sourceId: string;
  openedAt: number;
  amountEur: number;
  entryPriceEur: number;
  quantityBase: number;
}

export interface SignalAlertLogEntry {
  at: number;
  key: string;
  alertId: string;
  kind: "buy" | "sell";
  market: "gold" | "crypto";
  displayPair: string;
  delivered: boolean;
  suppressed: boolean;
  detail: string;
}

export interface SignalAlertState {
  schemaVersion: "signal-alert-state-v1";
  sent: Record<string, number>;
  holdings: Record<string, SignalHolding>;
  log: SignalAlertLogEntry[];
}

export function emptySignalAlertState(): SignalAlertState {
  return { schemaVersion: "signal-alert-state-v1", sent: {}, holdings: {}, log: [] };
}

export function parseSignalAlertState(raw: unknown): SignalAlertState {
  if (!raw || typeof raw !== "object") return emptySignalAlertState();
  const value = raw as Partial<SignalAlertState>;
  if (value.schemaVersion !== "signal-alert-state-v1") return emptySignalAlertState();
  return {
    schemaVersion: "signal-alert-state-v1",
    sent: value.sent && typeof value.sent === "object" ? { ...value.sent } : {},
    holdings: value.holdings && typeof value.holdings === "object" ? { ...value.holdings } : {},
    log: Array.isArray(value.log) ? [...value.log] : [],
  };
}

function pruneSent(sent: Record<string, number>): Record<string, number> {
  const entries = Object.entries(sent);
  if (entries.length <= MAX_SENT_KEYS) return sent;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SENT_KEYS));
}

/** Reclama una clave de alerta. Devuelve `false` si ya se reclamó antes. */
export function claimSignalAlert(state: SignalAlertState, key: string, now: number): boolean {
  if (state.sent[key] !== undefined) return false;
  state.sent[key] = now;
  state.sent = pruneSent(state.sent);
  return true;
}

/** Libera una clave cuando Telegram no confirmó la entrega, para reintentar. */
export function releaseSignalAlert(state: SignalAlertState, key: string): void {
  delete state.sent[key];
}

export interface SignalAlertCommit {
  openHolding?: SignalHolding | null;
  closeHoldingKey?: string | null;
  log: SignalAlertLogEntry;
}

export function commitSignalAlert(state: SignalAlertState, commit: SignalAlertCommit): void {
  if (commit.openHolding) state.holdings[commit.openHolding.holdingKey] = commit.openHolding;
  if (commit.closeHoldingKey) delete state.holdings[commit.closeHoldingKey];
  state.log = [commit.log, ...state.log].slice(0, MAX_LOG_ENTRIES);
}
