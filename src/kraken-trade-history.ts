import { KrakenApiError, normalizeCredential, signKrakenRequest } from "./kraken";
import type { LiveTradeExecution } from "./live-fill-evidence";

const API_BASE = "https://api.kraken.com/0";
const TRADES_HISTORY_PATH = "/0/private/TradesHistory";
const PAGE_SIZE = 50;

interface KrakenResponse<T> {
  error: string[];
  result: T;
}

export interface KrakenTradeHistoryPage {
  trades: LiveTradeExecution[];
  returnedCount: number;
  totalCount: number | null;
}

export interface KrakenTradeHistoryPageRequest {
  apiKey: string;
  apiSecret: string;
  nonce: string;
  startSeconds?: number;
  endSeconds?: number;
  offset?: number;
}

export interface KrakenOrderTradeEvidenceRequest {
  apiKey: string;
  apiSecret: string;
  nextNonce: () => Promise<string>;
  exchangeOrderIds: readonly string[];
  startSeconds?: number;
  endSeconds?: number;
  maxPages?: number;
  fetchPage?: (request: KrakenTradeHistoryPageRequest) => Promise<KrakenTradeHistoryPage>;
}

export interface KrakenOrderTradeEvidenceResult {
  trades: LiveTradeExecution[];
  coverageComplete: boolean;
  pagesFetched: number;
  accountRowsScanned: number;
  totalCount: number | null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMaker(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseKrakenTradeHistoryResult(raw: unknown): KrakenTradeHistoryPage {
  if (!raw || typeof raw !== "object") throw new Error("Kraken TradesHistory result is not an object");
  const result = raw as Record<string, unknown>;
  const rawTrades = result.trades;
  if (!rawTrades || typeof rawTrades !== "object" || Array.isArray(rawTrades)) {
    throw new Error("Kraken TradesHistory trades are missing");
  }

  const trades: LiveTradeExecution[] = [];
  for (const [tradeId, value] of Object.entries(rawTrades as Record<string, unknown>)) {
    if (!value || typeof value !== "object") throw new Error(`Malformed Kraken trade ${tradeId}`);
    const trade = value as Record<string, unknown>;
    const exchangeOrderId = typeof trade.ordertxid === "string" ? trade.ordertxid : "";
    const pair = typeof trade.pair === "string" ? trade.pair : "";
    const side = trade.type === "buy" || trade.type === "sell" ? trade.type : null;
    const timestampSeconds = finiteNumber(trade.time);
    const price = finiteNumber(trade.price);
    const costQuote = finiteNumber(trade.cost);
    const feeQuote = finiteNumber(trade.fee);
    const volumeBase = finiteNumber(trade.vol);

    if (!tradeId || !exchangeOrderId || !pair || !side || timestampSeconds === null
      || price === null || costQuote === null || feeQuote === null || volumeBase === null) {
      throw new Error(`Malformed Kraken trade ${tradeId}`);
    }

    trades.push({
      tradeId,
      exchangeOrderId,
      pair,
      side,
      timestampSeconds,
      price,
      costQuote,
      feeQuote,
      volumeBase,
      maker: parseMaker(trade.maker),
    });
  }

  const count = finiteNumber(result.count);
  return {
    trades,
    returnedCount: Object.keys(rawTrades as Record<string, unknown>).length,
    totalCount: count === null ? null : Math.max(0, Math.trunc(count)),
  };
}

export async function fetchKrakenTradeHistoryPage(
  request: KrakenTradeHistoryPageRequest,
): Promise<KrakenTradeHistoryPage> {
  const apiKey = normalizeCredential(request.apiKey);
  const apiSecret = normalizeCredential(request.apiSecret);
  if (!apiKey || !apiSecret) throw new Error("Kraken credentials are empty after normalization");

  const fields: Record<string, string> = {
    nonce: request.nonce,
    type: "all",
    trades: "false",
    consolidate_taker: "false",
    ledgers: "false",
    without_count: "false",
  };
  if (request.startSeconds !== undefined) fields.start = String(Math.max(0, Math.floor(request.startSeconds)));
  if (request.endSeconds !== undefined) fields.end = String(Math.max(0, Math.floor(request.endSeconds)));
  if (request.offset !== undefined) fields.ofs = String(Math.max(0, Math.floor(request.offset)));

  const postData = new URLSearchParams(fields).toString();
  const signature = await signKrakenRequest(TRADES_HISTORY_PATH, request.nonce, postData, apiSecret);
  const response = await fetch(`${API_BASE}${TRADES_HISTORY_PATH.replace(/^\/0/, "")}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "API-Key": apiKey,
      "API-Sign": signature,
      "User-Agent": "auto-bolsa-ai/live-fill-evidence",
    },
    body: postData,
  });
  if (!response.ok) throw new Error(`Kraken TradesHistory HTTP ${response.status}`);
  const payload = (await response.json()) as KrakenResponse<unknown>;
  if (!Array.isArray(payload.error)) throw new Error("Malformed Kraken TradesHistory error field");
  if (payload.error.length > 0) throw new KrakenApiError(payload.error);
  return parseKrakenTradeHistoryResult(payload.result);
}

export async function fetchTradeExecutionsForOrders(
  request: KrakenOrderTradeEvidenceRequest,
): Promise<KrakenOrderTradeEvidenceResult> {
  const wanted = new Set(request.exchangeOrderIds.filter((value) => value.length > 0));
  if (wanted.size === 0) {
    return { trades: [], coverageComplete: true, pagesFetched: 0, accountRowsScanned: 0, totalCount: 0 };
  }

  const maxPages = Math.max(1, Math.min(100, Math.trunc(request.maxPages ?? 20)));
  const fetchPage = request.fetchPage ?? fetchKrakenTradeHistoryPage;
  const executions = new Map<string, LiveTradeExecution>();
  let pagesFetched = 0;
  let accountRowsScanned = 0;
  let totalCount: number | null = null;
  let coverageComplete = false;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const nonce = await request.nextNonce();
    const pageRequest: KrakenTradeHistoryPageRequest = {
      apiKey: request.apiKey,
      apiSecret: request.apiSecret,
      nonce,
      offset: pageIndex * PAGE_SIZE,
    };
    if (request.startSeconds !== undefined) pageRequest.startSeconds = request.startSeconds;
    if (request.endSeconds !== undefined) pageRequest.endSeconds = request.endSeconds;
    const page = await fetchPage(pageRequest);
    pagesFetched += 1;
    accountRowsScanned += page.returnedCount;
    if (page.totalCount !== null) totalCount = page.totalCount;

    for (const trade of page.trades) {
      if (!wanted.has(trade.exchangeOrderId)) continue;
      const prior = executions.get(trade.tradeId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(trade)) {
        throw new Error(`Kraken trade ${trade.tradeId} changed across pagination pages`);
      }
      if (!prior) executions.set(trade.tradeId, trade);
    }

    if (page.returnedCount === 0) {
      coverageComplete = true;
      break;
    }
    if (totalCount !== null && accountRowsScanned >= totalCount) {
      coverageComplete = true;
      break;
    }
    if (totalCount === null && page.returnedCount < PAGE_SIZE) {
      coverageComplete = true;
      break;
    }
  }

  return {
    trades: [...executions.values()].sort((a, b) => {
      if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
      return a.tradeId.localeCompare(b.tradeId);
    }),
    coverageComplete,
    pagesFetched,
    accountRowsScanned,
    totalCount,
  };
}
