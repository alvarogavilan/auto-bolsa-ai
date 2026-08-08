import { closedOrders, fetchOhlc, openOrders } from "./kraken";
import { discoverKrakenGoldInstrument } from "./kraken-gold-instrument";
import { buildKrakenGoldProtectionPlan } from "./kraken-gold-protection";
import { placeKrakenStopLossOrder } from "./kraken-stop-loss";
import type { LiveExecutorSnapshot } from "./live-executor";

export const GOLD_PROTECTION_STORAGE_KEY = "kraken-gold-protection-v1";

export type GoldProtectionPhase = "submitting" | "active" | "ambiguous" | "closed";

export interface GoldProtectionRecord {
  schemaVersion: "kraken-gold-protection-v1";
  phase: GoldProtectionPhase;
  pair: string;
  clOrdId: string;
  exchangeOrderId: string | null;
  quantityBase: number;
  entryPrice: number;
  highestPrice: number;
  stopPrice: number;
  mode: "initial" | "break-even" | "trailing";
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt: number | null;
  blocker: string | null;
}

export type GoldProtectionResult =
  | { ok: true; status: "not-required" | "protected"; record: GoldProtectionRecord | null; detail: string }
  | { ok: false; status: "blocked"; record: GoldProtectionRecord | null; blocker: string };

interface GoldProtectionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface GoldProtectionContext {
  state: LiveExecutorSnapshot;
  configuredPair: string;
  apiKey: string;
  apiSecret: string;
  nextNonce: () => Promise<string>;
  storage: GoldProtectionStorage;
  now?: number;
}

const EPSILON = 1e-9;

function acceptedGoldPair(pair: string): boolean {
  return pair === "PAXGEUR" || pair === "XAUTZEUR" || pair === "XAUTEUR";
}

async function latestKrakenPrice(pair: string): Promise<number> {
  const candles = await fetchOhlc(pair, 1);
  const last = candles.at(-1)?.close ?? null;
  if (!Number.isFinite(last) || !(last! > 0)) throw new Error(`Precio Kraken no verificable para ${pair}`);
  return last!;
}

async function findProtectionByClOrdId(
  clOrdId: string,
  apiKey: string,
  apiSecret: string,
  nextNonce: () => Promise<string>,
): Promise<{ txid: string; status: string } | null> {
  const openNonce = await nextNonce();
  const open = await openOrders(apiKey, apiSecret, openNonce);
  const openMatch = open.find((order) => order.clOrdId === clOrdId);
  if (openMatch) return { txid: openMatch.txid, status: openMatch.status };

  const closedNonce = await nextNonce();
  const closed = await closedOrders(apiKey, apiSecret, closedNonce);
  const closedMatch = closed.find((order) => order.clOrdId === clOrdId);
  return closedMatch ? { txid: closedMatch.txid, status: closedMatch.status } : null;
}

function blocked(record: GoldProtectionRecord | null, blocker: string): GoldProtectionResult {
  return { ok: false, status: "blocked", record, blocker };
}

export async function ensureKrakenGoldInitialProtection(
  context: GoldProtectionContext,
): Promise<GoldProtectionResult> {
  const now = context.now ?? Date.now();
  const { state, configuredPair } = context;

  if (state.inventory.quantityBase <= EPSILON) {
    return { ok: true, status: "not-required", record: null, detail: "Sin inventario real que proteger" };
  }
  if (!acceptedGoldPair(configuredPair) || state.inventory.pair !== configuredPair) {
    return blocked(null, `Inventario o par configurado no corresponde a oro Kraken (${configuredPair})`);
  }
  if (!(state.inventory.averageCostEur !== null && state.inventory.averageCostEur > 0)) {
    return blocked(null, "Inventario real sin coste medio verificable");
  }
  if (state.activeClOrdId !== null) {
    return blocked(null, "Existe una orden de entrada/cierre aún activa; inventario parcial no puede declararse protegido");
  }

  const existing = (await context.storage.get<GoldProtectionRecord>(GOLD_PROTECTION_STORAGE_KEY)) ?? null;
  if (existing && (existing.phase === "submitting" || existing.phase === "ambiguous")) {
    const remote = await findProtectionByClOrdId(
      existing.clOrdId,
      context.apiKey,
      context.apiSecret,
      context.nextNonce,
    );
    if (!remote) {
      const ambiguous = { ...existing, phase: "ambiguous" as const, updatedAt: now, blocker: "Stop-loss remoto no localizado aún" };
      await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, ambiguous);
      return blocked(ambiguous, "Estado ambiguo del stop-loss: prohibido reenviar hasta reconciliarlo");
    }
    if (remote.status !== "open") {
      const closed = { ...existing, phase: "closed" as const, exchangeOrderId: remote.txid, updatedAt: now, lastVerifiedAt: now, blocker: `Stop-loss remoto status=${remote.status}` };
      await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, closed);
      return blocked(closed, `El stop-loss no está abierto en Kraken (status=${remote.status})`);
    }
    const recovered = { ...existing, phase: "active" as const, exchangeOrderId: remote.txid, updatedAt: now, lastVerifiedAt: now, blocker: null };
    await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, recovered);
    return { ok: true, status: "protected", record: recovered, detail: "Stop-loss recuperado por cl_ord_id" };
  }

  if (existing?.phase === "active") {
    if (existing.quantityBase + EPSILON < state.inventory.quantityBase) {
      return blocked(existing, "El inventario real supera el volumen actualmente protegido");
    }
    const remote = await findProtectionByClOrdId(
      existing.clOrdId,
      context.apiKey,
      context.apiSecret,
      context.nextNonce,
    );
    if (!remote || remote.status !== "open") {
      return blocked(existing, "El stop-loss persistido no está confirmado como abierto en Kraken");
    }
    const verified = { ...existing, exchangeOrderId: remote.txid, updatedAt: now, lastVerifiedAt: now, blocker: null };
    await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, verified);
    return { ok: true, status: "protected", record: verified, detail: "Stop-loss abierto verificado en Kraken" };
  }

  const instrument = await discoverKrakenGoldInstrument(now);
  if (!instrument || !instrument.tradable) return blocked(existing, "Instrumento de oro Kraken no operativo");
  if (instrument.altname !== configuredPair && instrument.pairKey !== configuredPair) {
    return blocked(existing, `El instrumento descubierto (${instrument.altname}) no coincide con ${configuredPair}`);
  }

  const currentPrice = await latestKrakenPrice(configuredPair);
  const tickSize = instrument.tickSize ?? 10 ** -instrument.priceDecimals;
  const entryPrice = state.inventory.averageCostEur;
  const plan = buildKrakenGoldProtectionPlan({
    entryPrice,
    currentPrice,
    highestPrice: currentPrice,
    tickSize,
    initialStopPct: 0.01,
    breakEvenTriggerPct: 0.02,
    trailingTriggerPct: 0.03,
    trailingDistancePct: 0.01,
    roundTripFeePct: 0.016,
    previousStopPrice: null,
  });

  const clOrdId = crypto.randomUUID();
  const prepared: GoldProtectionRecord = {
    schemaVersion: "kraken-gold-protection-v1",
    phase: "submitting",
    pair: configuredPair,
    clOrdId,
    exchangeOrderId: null,
    quantityBase: state.inventory.quantityBase,
    entryPrice,
    highestPrice: currentPrice,
    stopPrice: plan.effectiveStopPrice,
    mode: plan.mode,
    createdAt: now,
    updatedAt: now,
    lastVerifiedAt: null,
    blocker: null,
  };
  await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, prepared);

  try {
    const nonce = await context.nextNonce();
    const ack = await placeKrakenStopLossOrder({
      pair: configuredPair,
      volumeBase: state.inventory.quantityBase,
      stopPrice: plan.effectiveStopPrice,
      lotDecimals: instrument.lotDecimals,
      priceDecimals: instrument.priceDecimals,
      clOrdId,
    }, context.apiKey, context.apiSecret, nonce);
    const active: GoldProtectionRecord = {
      ...prepared,
      phase: "active",
      exchangeOrderId: ack.exchangeOrderId,
      updatedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      blocker: null,
    };
    await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, active);
    return { ok: true, status: "protected", record: active, detail: "Stop-loss inicial creado en Kraken" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al crear stop-loss";
    const ambiguous: GoldProtectionRecord = {
      ...prepared,
      phase: "ambiguous",
      updatedAt: Date.now(),
      blocker: message,
    };
    await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, ambiguous);
    return blocked(ambiguous, `Stop-loss no confirmado: ${message}`);
  }
}
