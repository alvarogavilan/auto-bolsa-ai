import { fetchAllTickers, type KrakenTicker } from "./kraken-markets";
import { fetchLivePairResolution, type LivePairResolution } from "./live-pair-metadata";
import type { LiveExecutorSnapshot } from "./live-executor";
import { buildPilotValidationProposalFromKraken } from "./pilot-validation-proposal";
import { sendTelegramManualTradeAlert } from "./telegram-manual-trade-alert";
import { telegramTradeApprovalConfigured } from "./telegram-trade-approval";
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

function latestApprovedInstruction(value: Record<string, unknown>): XauPaperInstruction | null {
  const cycles = Array.isArray(value.cycles) ? value.cycles as XauPaperCycleRecord[] : [];
  const latest = cycles[0];
  if (!latest || latest.outcome !== "approved") return null;
  return latest.instruction;
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

function bot(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function executor(env: Env): DurableObjectStub {
  return env.LIVE_EXECUTOR.get(env.LIVE_EXECUTOR.idFromName(LIVE_EXECUTOR_SINGLETON_NAME));
}

async function executorSnapshot(env: Env): Promise<LiveExecutorSnapshot | null> {
  const response = await executor(env).fetch("https://live/status");
  if (!response.ok) return null;
  return object(await response.json().catch(() => ({}))) as unknown as LiveExecutorSnapshot;
}

export interface XauPaxgManualAlertCycleResult {
  schemaVersion: "xau-paxg-manual-alert-v1";
  ran: boolean;
  action: "manual-action-required" | "hold" | "blocked";
  reason: string;
  detail?: unknown;
  liveTradingEnabled: false;
  realOrderSubmission: false;
}

export async function runXauPaxgManualAlertCycle(env: Env): Promise<XauPaxgManualAlertCycleResult> {
  if (!telegramTradeApprovalConfigured(env)) {
    return {
      schemaVersion: "xau-paxg-manual-alert-v1",
      ran: false,
      action: "blocked",
      reason: "Telegram privado no está configurado",
      liveTradingEnabled: false,
      realOrderSubmission: false,
    };
  }

  const xauResponse = await bot(env).fetch("https://bot/xau/status");
  if (!xauResponse.ok) {
    return {
      schemaVersion: "xau-paxg-manual-alert-v1",
      ran: false,
      action: "blocked",
      reason: `No se pudo leer el estado XAU (HTTP ${xauResponse.status})`,
      liveTradingEnabled: false,
      realOrderSubmission: false,
    };
  }

  const xau = object(await xauResponse.json());
  const instruction = latestApprovedInstruction(xau);
  if (!instruction || instruction.action === "hold") {
    return {
      schemaVersion: "xau-paxg-manual-alert-v1",
      ran: false,
      action: "hold",
      reason: "No existe una decisión XAU aprobada que requiera actuación manual",
      liveTradingEnabled: false,
      realOrderSubmission: false,
    };
  }

  try {
    if (instruction.action === "buy") {
      const proposal = await buildPilotValidationProposalFromKraken(env);
      const state = await executorSnapshot(env);
      const inventory = state?.inventory ?? {
        pair: null,
        quantityBase: 0,
        reservedQuantityBase: 0,
        averageEntryPrice: null,
        updatedAt: 0,
      };
      if (inventory.quantityBase > EPSILON) {
        return {
          schemaVersion: "xau-paxg-manual-alert-v1",
          ran: false,
          action: "hold",
          reason: "El ejecutor registra inventario PAXG; no se genera una nueva entrada manual",
          liveTradingEnabled: false,
          realOrderSubmission: false,
        };
      }
      const intent = buildXauPaxgSpotIntent(instruction, proposal, inventory);
      if (!intent.allowed || !intent.request) {
        return {
          schemaVersion: "xau-paxg-manual-alert-v1",
          ran: false,
          action: "blocked",
          reason: intent.blockers.join("; ") || "La entrada manual no supera los gates",
          detail: intent,
          liveTradingEnabled: false,
          realOrderSubmission: false,
        };
      }

      const notification = await sendTelegramManualTradeAlert(env, {
        pair: intent.request.pair,
        side: "buy",
        notionalEur: intent.request.notionalEur,
        limitPrice: intent.request.limitPrice,
        volumeBase: intent.request.volumeBase,
        xauReferencePrice: instruction.referencePrice,
        xauStopPrice: instruction.stopPrice,
        xauTargetPrice: instruction.initialTargetPrice,
        generatedAt: instruction.createdAt,
      });
      if (!notification.ok) {
        return {
          schemaVersion: "xau-paxg-manual-alert-v1",
          ran: false,
          action: "blocked",
          reason: "Telegram no confirmó la entrega de la operación manual",
          detail: notification,
          liveTradingEnabled: false,
          realOrderSubmission: false,
        };
      }
      return {
        schemaVersion: "xau-paxg-manual-alert-v1",
        ran: true,
        action: "manual-action-required",
        reason: "Operación BUY enviada a Telegram para ejecución manual en Kraken",
        detail: { telegramDelivered: true, pair: intent.request.pair, side: "buy", notionalEur: intent.request.notionalEur },
        liveTradingEnabled: false,
        realOrderSubmission: false,
      };
    }

    const pair = env.PAIR || "PAXGEUR";
    const [resolution, tickers] = await Promise.all([fetchLivePairResolution(pair), fetchAllTickers()]);
    const ticker = findTicker(tickers, resolution);
    if (!ticker || !Number.isFinite(ticker.bid) || ticker.bid <= 0) throw new Error("No existe bid PAXG/EUR verificable para la salida manual");
    const limitPrice = floorToDecimals(ticker.bid, resolution.metadata.priceDecimals);
    const referenceNotional = Math.max(0, Math.min(10, instruction.budgetEur));
    const volumeBase = referenceNotional > 0
      ? floorToDecimals(referenceNotional / limitPrice, resolution.metadata.lotDecimals)
      : null;
    const notification = await sendTelegramManualTradeAlert(env, {
      pair,
      side: "sell",
      notionalEur: referenceNotional,
      limitPrice,
      volumeBase,
      xauReferencePrice: instruction.referencePrice,
      xauStopPrice: instruction.stopPrice,
      xauTargetPrice: instruction.initialTargetPrice,
      generatedAt: instruction.createdAt,
    });
    if (!notification.ok) {
      return {
        schemaVersion: "xau-paxg-manual-alert-v1",
        ran: false,
        action: "blocked",
        reason: "Telegram no confirmó la entrega de la salida manual",
        detail: notification,
        liveTradingEnabled: false,
        realOrderSubmission: false,
      };
    }
    return {
      schemaVersion: "xau-paxg-manual-alert-v1",
      ran: true,
      action: "manual-action-required",
      reason: "Operación SELL enviada a Telegram para ejecución manual en Kraken; verifica que dispones de PAXG antes de vender",
      detail: { telegramDelivered: true, pair, side: "sell", referenceNotionalEur: referenceNotional },
      liveTradingEnabled: false,
      realOrderSubmission: false,
    };
  } catch (error) {
    return {
      schemaVersion: "xau-paxg-manual-alert-v1",
      ran: false,
      action: "blocked",
      reason: error instanceof Error ? error.message : "Fallo al generar la operación manual",
      liveTradingEnabled: false,
      realOrderSubmission: false,
    };
  }
}
