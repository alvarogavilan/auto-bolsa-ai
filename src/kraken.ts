import type { Candle } from "./types";

const API_BASE = "https://api.kraken.com/0";
const encoder = new TextEncoder();

type KrakenResponse<T> = { error: string[]; result: T };

export interface KrakenApiKeyInfo {
  apiKeyName: string | null;
  permissions: string[];
  validUntil: string | null;
  ipAllowlist: string[];
  lastUsed: string | null;
}

export interface KrakenCredentialDiagnostics {
  apiKeyPresent: boolean;
  apiKeyLength: number;
  apiKeyLast4: string | null;
  apiKeyCharactersRemoved: number;
  apiSecretPresent: boolean;
  apiSecretLength: number;
  apiSecretCharactersRemoved: number;
  apiSecretBase64Valid: boolean;
  apiSecretDecodedBytes: number | null;
}

export interface KrakenCredentialFingerprints {
  fingerprintAlgorithm: "SHA-256/64-bit-prefix";
  apiKeyFingerprint: string | null;
  apiSecretFingerprint: string | null;
}

export const REQUIRED_KRAKEN_PERMISSIONS = [
  "query-funds",
  "query-open-trades",
  "query-closed-trades",
  "modify-trades",
  "close-trades",
] as const;

export const FORBIDDEN_KRAKEN_PERMISSIONS = [
  "add-funds",
  "withdraw-funds",
  "earn-funds",
  "add-withdraw-address",
  "update-withdraw-address",
] as const;

function asNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

export function normalizeCredential(value: string): string {
  let normalized = value.trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1);
  }

  // API keys and base64 secrets never contain whitespace. Removing all whitespace,
  // zero-width characters and BOMs protects against copy/paste artefacts on iOS.
  return normalized.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
}

export function inspectKrakenCredentials(apiKey: string, apiSecret: string): KrakenCredentialDiagnostics {
  const normalizedApiKey = normalizeCredential(apiKey);
  const normalizedApiSecret = normalizeCredential(apiSecret);
  let apiSecretBase64Valid = false;
  let apiSecretDecodedBytes: number | null = null;

  try {
    const decoded = atob(normalizedApiSecret);
    apiSecretBase64Valid = normalizedApiSecret.length > 0;
    apiSecretDecodedBytes = decoded.length;
  } catch {
    apiSecretBase64Valid = false;
  }

  return {
    apiKeyPresent: normalizedApiKey.length > 0,
    apiKeyLength: normalizedApiKey.length,
    apiKeyLast4: normalizedApiKey.length >= 4 ? normalizedApiKey.slice(-4) : null,
    apiKeyCharactersRemoved: Math.max(0, apiKey.length - normalizedApiKey.length),
    apiSecretPresent: normalizedApiSecret.length > 0,
    apiSecretLength: normalizedApiSecret.length,
    apiSecretCharactersRemoved: Math.max(0, apiSecret.length - normalizedApiSecret.length),
    apiSecretBase64Valid,
    apiSecretDecodedBytes,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(normalizeCredential(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function fingerprintCredential(value: string): Promise<string | null> {
  const normalized = normalizeCredential(value);
  if (!normalized) return null;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", exactArrayBuffer(encoder.encode(normalized))),
  );
  return bytesToHex(digest.slice(0, 8));
}

export async function fingerprintKrakenCredentials(
  apiKey: string,
  apiSecret: string,
): Promise<KrakenCredentialFingerprints> {
  const [apiKeyFingerprint, apiSecretFingerprint] = await Promise.all([
    fingerprintCredential(apiKey),
    fingerprintCredential(apiSecret),
  ]);
  return {
    fingerprintAlgorithm: "SHA-256/64-bit-prefix",
    apiKeyFingerprint,
    apiSecretFingerprint,
  };
}

export function assessKrakenPermissions(permissions: string[]): {
  safe: boolean;
  missing: string[];
  forbidden: string[];
} {
  const permissionSet = new Set(permissions);
  const missing = REQUIRED_KRAKEN_PERMISSIONS.filter((permission) => !permissionSet.has(permission));
  const forbidden = FORBIDDEN_KRAKEN_PERMISSIONS.filter((permission) => permissionSet.has(permission));
  return { safe: missing.length === 0 && forbidden.length === 0, missing: [...missing], forbidden: [...forbidden] };
}

export async function signKrakenRequest(
  apiPath: string,
  nonce: string,
  postData: string,
  apiSecret: string,
): Promise<string> {
  const nonceAndBody = encoder.encode(nonce + postData);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", exactArrayBuffer(nonceAndBody)));
  const pathBytes = encoder.encode(apiPath);
  const message = new Uint8Array(pathBytes.length + hash.length);
  message.set(pathBytes, 0);
  message.set(hash, pathBytes.length);

  const secretBytes = base64ToBytes(apiSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(secretBytes),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, exactArrayBuffer(message)));
  return bytesToBase64(signature);
}

async function parsePrivateResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Kraken private HTTP ${response.status}`);
  const payload = (await response.json()) as KrakenResponse<T>;
  if (payload.error.length > 0) throw new Error(`Kraken private: ${payload.error.join(", ")}`);
  return payload.result;
}

async function privatePostForm<T>(
  apiPath: string,
  apiKey: string,
  apiSecret: string,
  nonce: string,
  fields: Record<string, string> = {},
): Promise<T> {
  const normalizedApiKey = normalizeCredential(apiKey);
  const normalizedApiSecret = normalizeCredential(apiSecret);
  if (!normalizedApiKey || !normalizedApiSecret) throw new Error("Kraken credentials are empty after normalization");

  const postData = new URLSearchParams({ nonce, ...fields }).toString();
  const signature = await signKrakenRequest(apiPath, nonce, postData, normalizedApiSecret);
  const response = await fetch(`${API_BASE}${apiPath.replace(/^\/0/, "")}`, {
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
  return parsePrivateResponse<T>(response);
}

async function privatePostJson<T>(
  apiPath: string,
  apiKey: string,
  apiSecret: string,
  nonce: string,
  fields: Record<string, string | number> = {},
): Promise<T> {
  const normalizedApiKey = normalizeCredential(apiKey);
  const normalizedApiSecret = normalizeCredential(apiSecret);
  if (!normalizedApiKey || !normalizedApiSecret) throw new Error("Kraken credentials are empty after normalization");

  const postData = JSON.stringify({ nonce: Number(nonce), ...fields });
  const signature = await signKrakenRequest(apiPath, nonce, postData, normalizedApiSecret);
  const response = await fetch(`${API_BASE}${apiPath.replace(/^\/0/, "")}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "API-Key": normalizedApiKey,
      "API-Sign": signature,
      "User-Agent": "auto-bolsa-ai/0.7",
    },
    body: postData,
  });
  return parsePrivateResponse<T>(response);
}

export async function fetchBalance(apiKey: string, apiSecret: string, nonce: string): Promise<Record<string, string>> {
  return privatePostForm<Record<string, string>>("/0/private/Balance", apiKey, apiSecret, nonce);
}

export async function fetchApiKeyInfo(apiKey: string, apiSecret: string, nonce: string): Promise<KrakenApiKeyInfo> {
  const result = await privatePostJson<Record<string, unknown>>(
    "/0/private/GetApiKeyInfo",
    apiKey,
    apiSecret,
    nonce,
  );
  const permissions = Array.isArray(result.permissions)
    ? result.permissions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    apiKeyName: typeof result.apiKeyName === "string" ? result.apiKeyName : null,
    permissions,
    validUntil: typeof result.validUntil === "string" ? result.validUntil : null,
    ipAllowlist: Array.isArray(result.ipAllowlist)
      ? result.ipAllowlist.filter((value): value is string => typeof value === "string")
      : [],
    lastUsed: typeof result.lastUsed === "string" || result.lastUsed === null ? result.lastUsed : null,
  };
}

export interface KrakenAddOrderRequest {
  pair: string;
  type: "buy" | "sell";
  ordertype: "limit" | "market";
  volume: string;
  price?: string;
  clOrdId: string;
  validate?: boolean;
}

export interface KrakenAddOrderResult {
  txid: string[];
  descr: { order?: string };
}

export interface KrakenOrderInfo {
  txid: string;
  status: string;
  clOrdId: string | null;
  volume: number;
  volumeExecuted: number;
  averagePrice: number | null;
  openTimestamp: number | null;
  closeTimestamp: number | null;
  reason: string | null;
}

// Cliente REST spot mínimo para crear, consultar y cancelar órdenes. Reutiliza la
// firma y el manejo de nonce ya validados en `privatePostJson`/`privatePostForm`.
// Ningún endpoint del Worker instancia el transporte que llama a estas funciones
// contra Kraken real: ver `KrakenLiveOrderTransport` en `live-transport.ts`.
export async function addOrder(
  request: KrakenAddOrderRequest,
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenAddOrderResult> {
  const fields: Record<string, string> = {
    pair: request.pair,
    type: request.type,
    ordertype: request.ordertype,
    volume: request.volume,
    cl_ord_id: request.clOrdId,
  };
  if (request.price) fields.price = request.price;
  if (request.validate) fields.validate = "true";
  const result = await privatePostForm<Record<string, unknown>>(
    "/0/private/AddOrder",
    apiKey,
    apiSecret,
    nonce,
    fields,
  );
  const txid = Array.isArray(result.txid)
    ? result.txid.filter((value): value is string => typeof value === "string")
    : [];
  const descr = (result.descr && typeof result.descr === "object" ? result.descr : {}) as { order?: string };
  return { txid, descr };
}

function parseOrderInfo(txid: string, raw: unknown): KrakenOrderInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const order = raw as Record<string, unknown>;
  return {
    txid,
    status: typeof order.status === "string" ? order.status : "unknown",
    clOrdId: typeof order.cl_ord_id === "string" ? order.cl_ord_id : null,
    volume: Number(order.vol ?? 0),
    volumeExecuted: Number(order.vol_exec ?? 0),
    averagePrice: order.price ? Number(order.price) : null,
    openTimestamp: order.opentm ? Number(order.opentm) : null,
    closeTimestamp: order.closetm ? Number(order.closetm) : null,
    reason: typeof order.reason === "string" ? order.reason : null,
  };
}

export async function queryOrders(
  txids: string[],
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenOrderInfo[]> {
  if (txids.length === 0) return [];
  const result = await privatePostForm<Record<string, unknown>>(
    "/0/private/QueryOrders",
    apiKey,
    apiSecret,
    nonce,
    { txid: txids.join(",") },
  );
  return Object.entries(result)
    .map(([txid, raw]) => parseOrderInfo(txid, raw))
    .filter((order): order is KrakenOrderInfo => order !== null);
}

export async function openOrders(
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenOrderInfo[]> {
  const result = await privatePostForm<{ open?: Record<string, unknown> }>(
    "/0/private/OpenOrders",
    apiKey,
    apiSecret,
    nonce,
  );
  return Object.entries(result.open ?? {})
    .map(([txid, raw]) => parseOrderInfo(txid, raw))
    .filter((order): order is KrakenOrderInfo => order !== null);
}

export async function closedOrders(
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<KrakenOrderInfo[]> {
  const result = await privatePostForm<{ closed?: Record<string, unknown> }>(
    "/0/private/ClosedOrders",
    apiKey,
    apiSecret,
    nonce,
  );
  return Object.entries(result.closed ?? {})
    .map(([txid, raw]) => parseOrderInfo(txid, raw))
    .filter((order): order is KrakenOrderInfo => order !== null);
}

export async function cancelOrder(
  txid: string,
  apiKey: string,
  apiSecret: string,
  nonce: string,
): Promise<{ count: number }> {
  const result = await privatePostForm<{ count?: number }>(
    "/0/private/CancelOrder",
    apiKey,
    apiSecret,
    nonce,
    { txid },
  );
  return { count: Number(result.count ?? 0) };
}

export async function fetchOhlc(pair: string, interval = 15): Promise<Candle[]> {
  const url = new URL(`${API_BASE}/public/OHLC`);
  url.searchParams.set("pair", pair);
  url.searchParams.set("interval", String(interval));

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "auto-bolsa-ai/0.7" },
  });
  if (!response.ok) throw new Error(`Kraken OHLC HTTP ${response.status}`);

  const payload = (await response.json()) as KrakenResponse<Record<string, unknown>>;
  if (payload.error.length > 0) throw new Error(`Kraken OHLC: ${payload.error.join(", ")}`);

  const resultKey = Object.keys(payload.result).find((key) => key !== "last");
  if (!resultKey) throw new Error("Kraken OHLC pair missing");
  const rows = payload.result[resultKey];
  if (!Array.isArray(rows)) throw new Error("Kraken OHLC candles missing");

  return rows.map((row): Candle => {
    if (!Array.isArray(row) || row.length < 7) throw new Error("Malformed Kraken candle");
    return {
      time: asNumber(row[0], "time"),
      open: asNumber(row[1], "open"),
      high: asNumber(row[2], "high"),
      low: asNumber(row[3], "low"),
      close: asNumber(row[4], "close"),
      volume: asNumber(row[6], "volume"),
    };
  });
}
