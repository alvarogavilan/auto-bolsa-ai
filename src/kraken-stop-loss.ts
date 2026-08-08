import { normalizeCredential, signKrakenRequest } from "./kraken";

const API_BASE = "https://api.kraken.com/0";

export interface KrakenStopLossRequest {
  pair: string;
  volumeBase: number;
  stopPrice: number;
  lotDecimals: number;
  priceDecimals: number;
  clOrdId: string;
}

export interface KrakenStopLossAck {
  exchangeOrderId: string;
  description: string | null;
}

function quantized(value: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(value * factor) / factor - value) < 1e-9;
}

export function validateKrakenGoldStopLoss(request: KrakenStopLossRequest): string[] {
  const blockers: string[] = [];
  if (request.pair !== "PAXGEUR" && request.pair !== "XAUTZEUR" && request.pair !== "XAUTEUR") {
    blockers.push(`Par de protección no permitido: ${request.pair}`);
  }
  if (!Number.isFinite(request.volumeBase) || request.volumeBase <= 0) blockers.push("volumeBase inválido");
  if (!Number.isFinite(request.stopPrice) || request.stopPrice <= 0) blockers.push("stopPrice inválido");
  if (!Number.isInteger(request.lotDecimals) || request.lotDecimals < 0) blockers.push("lotDecimals inválido");
  if (!Number.isInteger(request.priceDecimals) || request.priceDecimals < 0) blockers.push("priceDecimals inválido");
  if (Number.isFinite(request.volumeBase) && request.volumeBase > 0 && Number.isInteger(request.lotDecimals) && request.lotDecimals >= 0
      && !quantized(request.volumeBase, request.lotDecimals)) {
    blockers.push(`volumeBase no cuantizado a ${request.lotDecimals} decimales`);
  }
  if (Number.isFinite(request.stopPrice) && request.stopPrice > 0 && Number.isInteger(request.priceDecimals) && request.priceDecimals >= 0
      && !quantized(request.stopPrice, request.priceDecimals)) {
    blockers.push(`stopPrice no cuantizado a ${request.priceDecimals} decimales`);
  }
  if (!request.clOrdId || request.clOrdId.length > 36) blockers.push("clOrdId inválido");
  return blockers;
}

export function buildKrakenStopLossFields(request: KrakenStopLossRequest): Record<string, string> {
  const blockers = validateKrakenGoldStopLoss(request);
  if (blockers.length > 0) throw new Error(`Stop-loss Kraken bloqueado: ${blockers.join("; ")}`);
  return {
    pair: request.pair,
    type: "sell",
    ordertype: "stop-loss",
    volume: request.volumeBase.toFixed(request.lotDecimals),
    price: request.stopPrice.toFixed(request.priceDecimals),
    cl_ord_id: request.clOrdId,
  };
}

export async function placeKrakenStopLossOrder(
  request: KrakenStopLossRequest,
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenStopLossAck> {
  const normalizedApiKey = normalizeCredential(apiKey);
  const normalizedApiSecret = normalizeCredential(apiSecret);
  if (!normalizedApiKey || !normalizedApiSecret) throw new Error("Credenciales Kraken vacías");

  const apiPath = "/0/private/AddOrder";
  const fields = buildKrakenStopLossFields(request);
  const postData = new URLSearchParams({ nonce, ...fields }).toString();
  const signature = await signKrakenRequest(apiPath, nonce, postData, normalizedApiSecret);
  const response = await fetch(`${API_BASE}/private/AddOrder`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "API-Key": normalizedApiKey,
      "API-Sign": signature,
      "User-Agent": "auto-bolsa-ai/0.7",
    },
    body: postData,
  });
  if (!response.ok) throw new Error(`Kraken stop-loss HTTP ${response.status}`);
  const payload = await response.json() as {
    error?: string[];
    result?: { txid?: unknown; descr?: { order?: unknown } };
  };
  const errors = Array.isArray(payload.error) ? payload.error.filter((value): value is string => typeof value === "string") : [];
  if (errors.length > 0) throw new Error(`Kraken stop-loss: ${errors.join(", ")}`);
  const txids = Array.isArray(payload.result?.txid)
    ? payload.result!.txid.filter((value): value is string => typeof value === "string")
    : [];
  const exchangeOrderId = txids[0];
  if (!exchangeOrderId) throw new Error("Kraken stop-loss no devolvió txid");
  return {
    exchangeOrderId,
    description: typeof payload.result?.descr?.order === "string" ? payload.result.descr.order : null,
  };
}
