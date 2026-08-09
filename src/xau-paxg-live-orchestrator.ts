import { fetchAllTickers, type KrakenTicker } from "./kraken-markets";
import type { LiveExecutorSnapshot, LiveOrderRequest } from "./live-executor";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import { buildPilotValidationProposalFromKraken } from "./pilot-validation-proposal";
import { buildXauPaxgSpotIntent } from "./xau-paxg-spot-intent";
import type { XauPaperCycleRecord } from "./xau-usd-cycle-ledger";
import type { XauPaperInstruction } from "./xau-usd-paper-runtime";
import { BOT_STATE_SINGLETON_NAME, LIVE_EXECUTOR_SINGLETON_NAME, type Env } from "./types";

const EPSILON = 1e-9;

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

function findTicker(
  tickers: Record<string, KrakenTicker>,
  resolution: LivePairResolution,
): KrakenTicker | null {
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

async function callExecutor(
  env: Env,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
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

async function buildExitRequest(
  instruction: XauPaperInstruction,
  state: LiveExecutorSnapshot,
  env: Env,
): Promise<LiveOrderRequest> {
  if (state.inventory.quantityBase <= EPSILON || state.inventory.pair !== "PAXGEUR") {
    throw new Error("No existe inventario PAXGEUR reconciliado que cerrar");
  }
  if (state.inventory.reservedQuantityBase > EPSILON) {
    throw new Error("El inventario PAXG ya está reservado por otra orden");
  }

  const [resolution, tickers] = await Promise.all([
    fetchLivePairResolution("PAXGEUR"),
    fetchAllTickers(),
  ]);
  const ticker = findTicker(tickers, resolution);
  if (!ticker || !Number.isFinite(ticker.bid) || ticker.bid <= 0) {
    throw new Error("No existe bid PAXG/EUR verificable para la salida");
  }
  const volumeBase = floorToDecimals(state.inventory.quantityBase, resolution.metadata.lotDecimals);
  if (volumeBase < resolution.metadata.orderMinBase) {
    throw new Error("El inventario PAXG restante es inferior al mínimo operable de Kraken");
  }
  const limitPrice = floorToDecimals(ticker.bid, resolution.metadata.priceDecimals);
  const notionalEur = Math.round(volumeBase * limitPrice * 1_000_000) / 1_000_000;
  if (!(notionalEur > 0) || notionalEur > 5.25) {
    throw new Error(`La salida PAXG excede el perímetro del piloto (${notionalEur} EUR)`);
  }
  return {
    idempotencyKey: `xau-paxg-close:${instruction.createdAt}`,
    pair: env.PAIR || "PAXGEUR",
    side: "sell",
    volumeBase,
    limitPrice,
    notionalEur,
  };
}

async function executeCertifiedOrder(
  env: Env,
  request: LiveOrderRequest,
  releaseProtectionBeforeSubmit: boolean,
): Promise<Record<string, unknown>> {
  const prepared = await callExecutor(env, "/prepare", request);
  if (!prepared.ok || prepared.body.ok !== true) {
    return { ok: false, phase: "prepare", detail: prepared.body, status: prepared.status };
  }
  const order = object(prepared.body.order);
  const clOrdId = typeof order.clOrdId === "string" ? order.clOrdId : null;
  if (!clOrdId) return { ok: false, phase: "prepare", error: "Prepared order has no clOrdId" };

  const preflight = await callExecutor(env, "/preflight", { clOrdId });
  if (!preflight.ok || preflight.body.status !== "validated" || preflight.body.certificatePersisted !== true) {
    return { ok: false, phase: "preflight", clOrdId, detail: preflight.body, status: preflight.status };
  }

  if (releaseProtectionBeforeSubmit) {
    const release = await callExecutor(env, "/protection/release-for-exit", {});
    if (!release.ok || release.body.ok !== true) {
      return { ok: false, phase: "release-protection", clOrdId, detail: release.body, status: release.status };
    }
  }

  const submitted = await callExecutor(env, "/submit", { clOrdId });
  if (!submitted.ok || submitted.body.ok !== true) {
    const recovery = await callExecutor(env, "/reconcile", {});
    return {
      ok: false,
      phase: "submit",
      clOrdId,
      detail: submitted.body,
      recovery: recovery.body,
      status: submitted.status,
    };
  }

  const reconciled = await callExecutor(env, "/reconcile", {});
  if (!reconciled.ok) {
    return { ok: false, phase: "reconcile", clOrdId, detail: reconciled.body, status: reconciled.status };
  }
  return { ok: true, phase: "complete", clOrdId, reconciliation: reconciled.body };
}

export interface XauPaxgLiveCycleResult {
  schemaVersion: "xau-paxg-live-cycle-v1";
  ran: boolean;
  action: "open-long" | "close-long" | "hold" | "blocked";
  reason: string;
  detail?: unknown;
  liveTradingEnabled: boolean;
}

/**
 * Único orquestador capaz de recorrer el ciclo real. Es inerte salvo que
 * LIVE_TRADING_ENABLED=true, TRADING_MODE=live y PAIR=PAXGEUR coincidan a la vez.
 */
export async function runXauPaxgLiveCycle(env: Env): Promise<XauPaxgLiveCycleResult> {
  const liveEnabled = env.LIVE_TRADING_ENABLED === "true"
    && env.TRADING_MODE === "live"
    && (env.PAIR || "") === "PAXGEUR";
  if (!liveEnabled) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "blocked",
      reason: "LIVE requiere simultáneamente LIVE_TRADING_ENABLED=true, TRADING_MODE=live y PAIR=PAXGEUR",
      liveTradingEnabled: false,
    };
  }
  if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "blocked",
      reason: "Faltan credenciales Kraken",
      liveTradingEnabled: true,
    };
  }

  const [xauResponse, stateResponse] = await Promise.all([
    bot(env).fetch("https://bot/xau/status"),
    callExecutor(env, "/status"),
  ]);
  if (!xauResponse.ok || !stateResponse.ok) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "blocked",
      reason: "No se pudo leer el estado XAU/PAXG",
      liveTradingEnabled: true,
    };
  }

  const xau = object(await xauResponse.json());
  const state = stateResponse.body as unknown as LiveExecutorSnapshot;
  const instruction = latestApprovedInstruction(xau);
  if (!instruction) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "hold",
      reason: "No existe una decisión XAU aprobada pendiente",
      liveTradingEnabled: true,
    };
  }

  if (instruction.action === "buy") {
    const key = `xau-paxg-open:${instruction.createdAt}`;
    if (alreadyProcessed(state, key)) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "BUY ya procesado", liveTradingEnabled: true };
    }
    if (state.inventory.quantityBase > EPSILON) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "Ya existe inventario PAXG; no se piramida", liveTradingEnabled: true };
    }
    try {
      const proposal = await buildPilotValidationProposalFromKraken(env);
      const intent = buildXauPaxgSpotIntent(instruction, proposal, state.inventory);
      if (!intent.allowed || !intent.request) {
        return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: intent.blockers.join("; "), liveTradingEnabled: true };
      }
      const detail = await executeCertifiedOrder(env, intent.request, false);
      return {
        schemaVersion: "xau-paxg-live-cycle-v1",
        ran: detail.ok === true,
        action: "open-long",
        reason: detail.ok === true ? "Entrada PAXG certificada, reconciliada y protegida" : "La entrada se detuvo en fail-closed",
        detail,
        liveTradingEnabled: true,
      };
    } catch (error) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: error instanceof Error ? error.message : "BUY failed", liveTradingEnabled: true };
    }
  }

  if (instruction.action === "sell") {
    const key = `xau-paxg-close:${instruction.createdAt}`;
    if (alreadyProcessed(state, key)) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "SELL ya procesado", liveTradingEnabled: true };
    }
    if (state.inventory.quantityBase <= EPSILON) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "hold", reason: "SELL XAU con cuenta plana no abre cortos en Kraken Spot", liveTradingEnabled: true };
    }
    try {
      const request = await buildExitRequest(instruction, state, env);
      const detail = await executeCertifiedOrder(env, request, true);
      return {
        schemaVersion: "xau-paxg-live-cycle-v1",
        ran: detail.ok === true,
        action: "close-long",
        reason: detail.ok === true ? "Salida PAXG certificada y reconciliada" : "La salida se detuvo y se ejecutó recuperación fail-closed",
        detail,
        liveTradingEnabled: true,
      };
    } catch (error) {
      return { schemaVersion: "xau-paxg-live-cycle-v1", ran: false, action: "blocked", reason: error instanceof Error ? error.message : "SELL failed", liveTradingEnabled: true };
    }
  }

  return {
    schemaVersion: "xau-paxg-live-cycle-v1",
    ran: false,
    action: "hold",
    reason: "La decisión XAU no requiere ejecución",
    liveTradingEnabled: true,
  };
}
