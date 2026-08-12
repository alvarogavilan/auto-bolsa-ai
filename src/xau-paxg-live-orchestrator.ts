import { fetchAllTickers, type KrakenTicker } from "./kraken-markets";
import type { LiveExecutorSnapshot, LiveOrderRequest } from "./live-executor";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import { buildPilotValidationProposalFromKraken } from "./pilot-validation-proposal";
import { buildXauPaxgSpotIntent } from "./xau-paxg-spot-intent";
import { sendTelegramTradeApproval, telegramTradeApprovalConfigured } from "./telegram-trade-approval";
import type { XauPaperCycleRecord } from "./xau-usd-cycle-ledger";
import type { XauPaperInstruction } from "./xau-usd-paper-runtime";
import { BOT_STATE_SINGLETON_NAME, LIVE_EXECUTOR_SINGLETON_NAME, type Env } from "./types";

const EPSILON = 1e-9;
const PUBLIC_WORKER_BASE_URL = "https://auto-bolsa-ai.k8mwkbp68y.workers.dev";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePair(value: string): string {
  return value.toUpperCase().replaceAll("/", "").replaceAll("-", "").trim();
}

function floorToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-12) / factor;
}

function findTicker(tickers: Record<string, KrakenTicker>, resolution: LivePairResolution): KrakenTicker | null {
  const accepted = new Set(
    [resolution.canonicalPair, resolution.requestedPair, ...resolution.acceptedPairCodes].map(normalizePair),
  );
  for (const [key, ticker] of Object.entries(tickers)) {
    if (accepted.has(normalizePair(key))) return ticker;
  }
  return null;
}

function latestApprovedInstruction(value: Record<string, unknown>): XauPaperInstruction | null {
  const cycles = Array.isArray(value.cycles) ? value.cycles as XauPaperCycleRecord[] : [];
  const latest = cycles[0];
  if (!latest || latest.outcome !== "approved") return null;
  return latest.instruction;
}

function bot(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function executor(env: Env): DurableObjectStub {
  return env.LIVE_EXECUTOR.get(env.LIVE_EXECUTOR.idFromName(LIVE_EXECUTOR_SINGLETON_NAME));
}

async function callExecutor(env: Env, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const init: RequestInit = body === undefined
    ? { method: "GET", headers: { "Content-Type": "application/json" } }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await executor(env).fetch(`https://live${path}`, init);
  const parsed = object(await response.json().catch(() => ({})));
  return { ok: response.ok, status: response.status, body: parsed };
}

function alreadyProcessed(state: LiveExecutorSnapshot, idempotencyKey: string): boolean {
  const clOrdId = state.idempotencyIndex[idempotencyKey];
  if (!clOrdId) return false;
  const order = state.orders[clOrdId];
  return Boolean(order && order.status !== "prepared");
}

async function buildExitRequest(instruction: XauPaperInstruction, state: LiveExecutorSnapshot, env: Env): Promise<LiveOrderRequest> {
  if (state.inventory.quantityBase <= EPSILON || state.inventory.pair !== "PAXGEUR") throw new Error("No existe inventario PAXGEUR reconciliado que cerrar");
  if (state.inventory.reservedQuantityBase > EPSILON) throw new Error("El inventario PAXG ya está reservado por otra orden");
  const [resolution, tickers] = await Promise.all([fetchLivePairResolution("PAXGEUR"), fetchAllTickers()]);
  const ticker = findTicker(tickers, resolution);
  if (!ticker || !Number.isFinite(ticker.bid) || ticker.bid <= 0) throw new Error("No existe bid PAXG/EUR verificable para la salida");
  const volumeBase = floorToDecimals(state.inventory.quantityBase, resolution.metadata.lotDecimals);
  if (volumeBase < resolution.metadata.orderMinBase) throw new Error("El inventario PAXG restante es inferior al mínimo operable de Kraken");
  const limitPrice = floorToDecimals(ticker.bid, resolution.metadata.priceDecimals);
  const notionalEur = Math.round(volumeBase * limitPrice * 1_000_000) / 1_000_000;
  if (!(notionalEur > 0)) throw new Error("La salida PAXG no tiene un nocional válido");
  return { idempotencyKey: `xau-paxg-close:${instruction.createdAt}`, pair: env.PAIR || "PAXGEUR", side: "sell", volumeBase, limitPrice, notionalEur };
}

async function requestCertifiedApproval(
  env: Env,
  request: LiveOrderRequest,
  eurBalance: number | null,
): Promise<Record<string, unknown>> {
  if (!telegramTradeApprovalConfigured(env)) {
    return { ok: false, phase: "telegram", error: "Telegram privado no está configurado en Auto Bolsa" };
  }
  const prepared = eurBalance !== null
    ? await callExecutor(env, "/prepare-validation", { eurBalance, request })
    : await callExecutor(env, "/prepare", request);
  if (!prepared.ok || prepared.body.ok !== true) return { ok: false, phase: "prepare", detail: prepared.body, status: prepared.status };
  const order = object(prepared.body.order);
  const clOrdId = typeof order.clOrdId === "string" ? order.clOrdId : null;
  if (!clOrdId) return { ok: false, phase: "prepare", error: "Prepared order has no clOrdId" };

  const preflight = await callExecutor(env, "/preflight", { clOrdId });
  if (!preflight.ok || preflight.body.status !== "validated" || preflight.body.certificatePersisted !== true) {
    return { ok: false, phase: "preflight", clOrdId, detail: preflight.body, status: preflight.status };
  }

  const approval = await callExecutor(env, "/approval/create", { clOrdId });
  if (!approval.ok || approval.body.ok !== true) {
    if (approval.body.error === "APPROVAL_ALREADY_PENDING") {
      return { ok: true, phase: "awaiting-approval", clOrdId, deduplicated: true, expiresAt: approval.body.expiresAt };
    }
    return { ok: false, phase: "approval-create", clOrdId, detail: approval.body, status: approval.status };
  }
  const token = typeof approval.body.token === "string" ? approval.body.token : "";
  const expiresAt = Number(approval.body.expiresAt);
  if (!token || !Number.isFinite(expiresAt)) return { ok: false, phase: "approval-create", error: "Approval token missing" };

  const approvalUrl = `${PUBLIC_WORKER_BASE_URL}/api/pilot/authorize-trade?token=${encodeURIComponent(token)}`;
  const rejectUrl = `${PUBLIC_WORKER_BASE_URL}/api/pilot/authorize-trade?token=${encodeURIComponent(token)}&decision=reject`;
  const notification = await sendTelegramTradeApproval(env, {
    approvalUrl,
    rejectUrl,
    pair: request.pair,
    side: request.side,
    notionalEur: request.notionalEur,
    limitPrice: request.limitPrice,
    expiresAt,
  });
  if (!notification.ok) return { ok: false, phase: "telegram", clOrdId, expiresAt, notification };
  return { ok: true, phase: "awaiting-approval", clOrdId, expiresAt, telegramDelivered: true };
}

export interface XauPaxgLiveCycleResult {
  schemaVersion: "xau-paxg-live-cycle-v1";
  ran: boolean;
  action: "open-long" | "close-long" | "awaiting-approval" | "hold" | "blocked";
  reason: string;
  detail?: unknown;
  liveTradingEnabled: boolean;
}

export async function runXauPaxgLiveCycle(env: Env): Promise<XauPaxgLiveCycleResult> {
  const liveEnabled = env.LIVE_TRADING_ENABLED === "true" && env.TRADING_MODE === "live" && (env.PAIR || "") === "PAXGEUR";
  if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
    return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: "Faltan credenciales Kraken", liveTradingEnabled: liveEnabled };
  }

  const [xauResponse, stateResponse] = await Promise.all([bot(env).fetch("https://bot/xau/status"), callExecutor(env, "/status")]);
  if (!xauResponse.ok || !stateResponse.ok) {
    return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: "No se pudo leer el estado XAU/PAXG", liveTradingEnabled: liveEnabled };
  }
  const xau = object(await xauResponse.json());
  const state = stateResponse.body as unknown as LiveExecutorSnapshot;
  const instruction = latestApprovedInstruction(xau);
  if (!instruction) {
    return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "No existe una decisión XAU aprobada pendiente", liveTradingEnabled: liveEnabled };
  }

  if (instruction.action === "buy") {
    const key = `xau-paxg-open:${instruction.createdAt}`;
    if (alreadyProcessed(state, key)) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "BUY ya procesado", liveTradingEnabled: liveEnabled };
    if (state.inventory.quantityBase > EPSILON) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "Ya existe inventario PAXG; no se piramida", liveTradingEnabled: liveEnabled };
    try {
      const proposal = await buildPilotValidationProposalFromKraken(env);
      const intent = buildXauPaxgSpotIntent(instruction, proposal, state.inventory);
      if (!intent.allowed || !intent.request) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: intent.blockers.join("; "), liveTradingEnabled: liveEnabled };
      const detail = await requestCertifiedApproval(env, intent.request, proposal.eurBalance);
      return {
        schemaVersion: "xau-paxg-live-cycle-v1",
        ran: false,
        action: detail.ok === true ? "awaiting-approval" : "blocked",
        reason: detail.ok === true ? "Preflight Kraken validado; autorización enviada a Telegram" : "La solicitud de autorización se detuvo en fail-closed",
        detail,
        liveTradingEnabled: liveEnabled,
      };
    } catch (error) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: error instanceof Error ? error.message : "BUY approval failed", liveTradingEnabled: liveEnabled };
    }
  }

  if (instruction.action === "sell") {
    const key = `xau-paxg-close:${instruction.createdAt}`;
    if (alreadyProcessed(state, key)) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "SELL ya procesado", liveTradingEnabled: liveEnabled };
    if (state.inventory.quantityBase <= EPSILON) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "SELL XAU con cuenta plana no abre cortos en Kraken Spot", liveTradingEnabled: liveEnabled };
    if (!liveEnabled) return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: "Una salida de inventario real requiere LIVE armado", liveTradingEnabled: false };
    try {
      const request = await buildExitRequest(instruction, state, env);
      const detail = await requestCertifiedApproval(env, request, null);
      return {
        schemaVersion: "xau-paxg-live-cycle-v1",
        ran: false,
        action: detail.ok === true ? "awaiting-approval" : "blocked",
        reason: detail.ok === true ? "Salida PAXG validada; autorización enviada a Telegram" : "La solicitud de salida se detuvo en fail-closed",
        detail,
        liveTradingEnabled: true,
      };
    } catch (error) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: error instanceof Error ? error.message : "SELL approval failed", liveTradingEnabled: true };
    }
  }

  return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "La decisión XAU no requiere ejecución", liveTradingEnabled: liveEnabled };
}
