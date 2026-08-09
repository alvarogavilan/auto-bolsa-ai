import type { LiveExecutorSnapshot } from "./live-executor";
import {
  ensureKrakenGoldInitialProtection,
  GOLD_PROTECTION_STORAGE_KEY,
  type GoldProtectionRecord,
  type GoldProtectionResult,
} from "./kraken-gold-protection-controller";
import { KrakenLiveOrderTransport, type LiveOrderTransport } from "./live-transport";

interface GoldProtectionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface GoldProtectionLifecycleContext {
  state: LiveExecutorSnapshot;
  configuredPair: string;
  apiKey: string;
  apiSecret: string;
  nextNonce: () => Promise<string>;
  storage: GoldProtectionStorage;
  transport?: LiveOrderTransport;
  now?: number;
}

export interface GoldProtectionReleaseResult {
  ok: boolean;
  released: boolean;
  record: GoldProtectionRecord | null;
  blocker: string | null;
}

const EPSILON = 1e-9;

function transportFor(context: GoldProtectionLifecycleContext): LiveOrderTransport {
  return context.transport ?? new KrakenLiveOrderTransport(
    context.apiKey,
    context.apiSecret,
    context.nextNonce,
  );
}

async function releaseExistingProtection(
  context: GoldProtectionLifecycleContext,
  reason: string,
): Promise<GoldProtectionReleaseResult> {
  const now = context.now ?? Date.now();
  const existing = (await context.storage.get<GoldProtectionRecord>(GOLD_PROTECTION_STORAGE_KEY)) ?? null;
  if (!existing || existing.phase === "closed") {
    return { ok: true, released: false, record: existing, blocker: null };
  }

  const transport = transportFor(context);
  let remote = await transport.findByClOrdId(existing.clOrdId);
  if (!remote && existing.exchangeOrderId) {
    remote = await transport.queryOrder(existing.exchangeOrderId);
  }
  if (!remote) {
    return {
      ok: false,
      released: false,
      record: existing,
      blocker: "No se puede confirmar el estado remoto del stop-loss antes de liberarlo",
    };
  }

  if (remote.status === "open") {
    const cancelled = await transport.cancelOrder(remote.exchangeOrderId);
    if (!cancelled.cancelled) {
      return {
        ok: false,
        released: false,
        record: existing,
        blocker: "Kraken no confirmó la cancelación del stop-loss",
      };
    }
  } else if (remote.status === "unknown") {
    return {
      ok: false,
      released: false,
      record: existing,
      blocker: "El stop-loss remoto está en estado desconocido",
    };
  }

  const closed: GoldProtectionRecord = {
    ...existing,
    phase: "closed",
    exchangeOrderId: remote.exchangeOrderId,
    updatedAt: now,
    lastVerifiedAt: now,
    blocker: reason,
  };
  await context.storage.put(GOLD_PROTECTION_STORAGE_KEY, closed);
  return { ok: true, released: true, record: closed, blocker: null };
}

/** Cancela de forma verificable el stop antes de una salida discrecional FOK. */
export async function releaseKrakenGoldProtectionForExit(
  context: GoldProtectionLifecycleContext,
): Promise<GoldProtectionReleaseResult> {
  if (context.state.inventory.quantityBase <= EPSILON) {
    return { ok: false, released: false, record: null, blocker: "No existe inventario real que cerrar" };
  }
  return releaseExistingProtection(context, "Stop liberado para salida FOK verificada");
}

/**
 * Mantiene la protección coherente con el inventario reconciliado: si hay oro,
 * exige un stop abierto; si ya no hay inventario, elimina cualquier stop residual.
 */
export async function reconcileKrakenGoldProtection(
  context: GoldProtectionLifecycleContext,
): Promise<GoldProtectionResult | GoldProtectionReleaseResult> {
  if (context.state.inventory.quantityBase <= EPSILON) {
    return releaseExistingProtection(context, "Inventario cerrado; stop residual cancelado");
  }
  return ensureKrakenGoldInitialProtection(context);
}
