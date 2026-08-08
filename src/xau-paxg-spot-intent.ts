import type { LiveInventory, LiveOrderRequest } from "./live-executor";
import type { PilotValidationProposal } from "./pilot-validation-proposal";
import type { XauPaperInstruction } from "./xau-usd-paper-runtime";

export interface XauPaxgSpotIntent {
  schemaVersion: "xau-paxg-spot-intent-v1";
  createdAt: number;
  sourceMarket: "XAU/USD";
  executionMarket: "PAXG/EUR";
  action: "open-long" | "close-long" | "hold";
  allowed: boolean;
  request: LiveOrderRequest | null;
  blockers: string[];
  shortSellingSupported: false;
}

const EPSILON = 1e-9;

function validInventory(inventory: LiveInventory): boolean {
  return Number.isFinite(inventory.quantityBase)
    && inventory.quantityBase >= 0
    && Number.isFinite(inventory.reservedQuantityBase)
    && inventory.reservedQuantityBase >= 0;
}

/**
 * Adapta una decisión direccional XAU/USD a Kraken Spot sin inventar cortos.
 * BUY puede abrir PAXG únicamente con cuenta plana. SELL solo puede cerrar
 * inventario PAXG realmente existente; una señal short con cuenta plana se
 * convierte en HOLD explícito.
 */
export function buildXauPaxgSpotIntent(
  instruction: XauPaperInstruction,
  proposal: PilotValidationProposal | null,
  inventory: LiveInventory,
  now = Date.now(),
): XauPaxgSpotIntent {
  const blockers: string[] = [];
  if (!validInventory(inventory)) blockers.push("Inventario LIVE inválido");
  if (instruction.market !== "XAU/USD") blockers.push("La señal no pertenece a XAU/USD");
  if (!instruction.allowed || instruction.action === "hold") blockers.push("La señal XAU no está aprobada para ejecución");

  const hasInventory = inventory.quantityBase > EPSILON;
  if (instruction.action === "buy") {
    if (hasInventory) blockers.push("Ya existe inventario PAXG; no se permite piramidar");
    if (!proposal) blockers.push("No existe propuesta PAXG/EUR verificada contra Kraken");
    if (proposal && proposal.pair !== "PAXGEUR") blockers.push(`La propuesta no corresponde a PAXGEUR (${proposal.pair})`);
    if (proposal && proposal.request.side !== "buy") blockers.push("La propuesta de apertura no es BUY");
    if (blockers.length === 0 && proposal) {
      return {
        schemaVersion: "xau-paxg-spot-intent-v1",
        createdAt: now,
        sourceMarket: "XAU/USD",
        executionMarket: "PAXG/EUR",
        action: "open-long",
        allowed: true,
        request: { ...proposal.request, idempotencyKey: `xau-paxg-open:${instruction.createdAt}` },
        blockers: [],
        shortSellingSupported: false,
      };
    }
  }

  if (instruction.action === "sell") {
    if (!hasInventory) blockers.push("Kraken Spot no admite abrir un corto PAXG desde saldo plano");
    if (hasInventory && inventory.pair !== "PAXGEUR") blockers.push(`El inventario existente pertenece a ${inventory.pair ?? "un par desconocido"}`);
    if (inventory.reservedQuantityBase > EPSILON) blockers.push("Parte del inventario ya está reservada por otra orden");
    if (blockers.length === 0 && hasInventory) {
      const referencePrice = instruction.referencePrice;
      if (!Number.isFinite(referencePrice) || !(referencePrice! > 0)) {
        blockers.push("La señal SELL no contiene precio de referencia válido");
      } else {
        return {
          schemaVersion: "xau-paxg-spot-intent-v1",
          createdAt: now,
          sourceMarket: "XAU/USD",
          executionMarket: "PAXG/EUR",
          action: "close-long",
          allowed: false,
          request: null,
          blockers: ["La señal de salida necesita precio PAXG/EUR real; no se reutiliza el precio XAU/USD como precio de orden"],
          shortSellingSupported: false,
        };
      }
    }
  }

  return {
    schemaVersion: "xau-paxg-spot-intent-v1",
    createdAt: now,
    sourceMarket: "XAU/USD",
    executionMarket: "PAXG/EUR",
    action: "hold",
    allowed: false,
    request: null,
    blockers,
    shortSellingSupported: false,
  };
}
