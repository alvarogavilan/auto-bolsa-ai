import { KrakenApiError, normalizeCredential, signKrakenRequest } from "./kraken";

const API_BASE = "https://api.kraken.com/0";
const ADD_ORDER_PATH = "/0/private/AddOrder";

export interface KrakenFokLimitOrderRequest {
  pair: string;
  type: "buy" | "sell";
  volume: string;
  price: string;
  clOrdId: string;
  validate?: boolean;
}

export interface KrakenFokLimitOrderResult {
  txid: string[];
  descr: { order?: string };
}

export function buildKrakenFokLimitFields(
  request: KrakenFokLimitOrderRequest,
): Record<string, string> {
  const fields: Record<string, string> = {
    pair: request.pair,
    type: request.type,
    ordertype: "limit",
    volume: request.volume,
    price: request.price,
    cl_ord_id: request.clOrdId,
    timeinforce: "FOK",
  };
  if (request.validate) fields.validate = "true";
  return fields;
}

/**
 * Única forma de entrada PAXG LIVE: limit + FOK. La misma función sirve para
 * validate=true y para el envío real, evitando que el preflight certifique una
 * semántica diferente de la orden que luego llega al matching engine.
 */
export async function addKrakenFokLimitOrder(
  request: KrakenFokLimitOrderRequest,
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenFokLimitOrderResult> {
  const normalizedApiKey = normalizeCredential(apiKey);
  const normalizedApiSecret = normalizeCredential(apiSecret);
  if (!normalizedApiKey || !normalizedApiSecret) throw new Error("Kraken credentials are empty after normalization");

  const postData = new URLSearchParams({ nonce, ...buildKrakenFokLimitFields(request) }).toString();
  const signature = await signKrakenRequest(ADD_ORDER_PATH, nonce, postData, normalizedApiSecret);
  const response = await fetch(`${API_BASE}/private/AddOrder`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "API-Key": normalizedApiKey,
      "API-Sign": signature,
      "User-Agent": "auto-bolsa-ai/fok-entry-v1",
    },
    body: postData,
  });
  if (!response.ok) throw new Error(`Kraken FOK HTTP ${response.status}`);
  const payload = await response.json() as {
    error?: unknown;
    result?: unknown;
  };
  const errors = Array.isArray(payload.error)
    ? payload.error.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  if (errors.length > 0) throw new KrakenApiError(errors);
  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("Kraken FOK result is missing");
  }
  const result = payload.result as Record<string, unknown>;
  const txid = Array.isArray(result.txid)
    ? result.txid.filter((value): value is string => typeof value === "string")
    : [];
  const descr = result.descr && typeof result.descr === "object" && !Array.isArray(result.descr)
    ? result.descr as { order?: string }
    : {};
  return { txid, descr };
}
