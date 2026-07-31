import {
  isKrakenOrderRejection,
  type KrakenAddOrderRequest,
  type KrakenAddOrderResult,
} from "./kraken";
import {
  validateOrderIntent,
  type LivePairMetadata,
} from "./live-guardrails";
import {
  submitKrakenValidateOnlyOrder,
  type KrakenValidateOnlyOrderCall,
} from "./live-transport";

export const PREFLIGHT_MAX_NOTIONAL_EUR = 5;

export interface LiveOrderPreflightIntent {
  pair: string;
  side: "buy";
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
}

export type ValidateOnlyKrakenCall = KrakenValidateOnlyOrderCall;
export type ValidateOnlySubmitter = (call: ValidateOnlyKrakenCall) => Promise<KrakenAddOrderResult>;

export interface LiveOrderPreflightResult {
  schemaVersion: "kraken-order-preflight-v1";
  checkedAt: number;
  validateOnly: true;
  orderCreated: false;
  accepted: boolean;
  krakenEvaluated: boolean;
  pair: string;
  side: "buy";
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
  clOrdId: string;
  description: string | null;
  rejectionCodes: string[];
  message: string;
  liveTrading: false;
}

export interface RunPreflightOptions {
  intent: LiveOrderPreflightIntent;
  metadata: LivePairMetadata;
  apiKey: string;
  apiSecret: string;
  nonce: string;
  now?: number;
  submit?: ValidateOnlySubmitter;
}

function validateIntent(intent: LiveOrderPreflightIntent, metadata: LivePairMetadata): string[] {
  const blockers = validateOrderIntent(
    {
      pair: intent.pair,
      volumeBase: intent.volumeBase,
      limitPrice: intent.limitPrice,
      notionalEur: intent.notionalEur,
    },
    {
      pairMetadata: { [intent.pair]: metadata },
      maxNotionalDeviationPct: 0.01,
    },
  );
  if ((intent as { side?: unknown }).side !== "buy") {
    blockers.push("El preflight solo admite compras límite validate-only");
  }
  if (intent.notionalEur > PREFLIGHT_MAX_NOTIONAL_EUR) {
    blockers.push(`El preflight no admite más de ${PREFLIGHT_MAX_NOTIONAL_EUR} EUR`);
  }
  return blockers;
}

/**
 * Pide a Kraken que valide una compra límite sin crearla. El resultado solo se
 * considera correcto si no contiene ningún txid. Cualquier txid sería una
 * violación crítica del contrato y provoca error, nunca una aparente aprobación.
 */
export async function runValidateOnlyOrderPreflight(
  options: RunPreflightOptions,
): Promise<LiveOrderPreflightResult> {
  const blockers = validateIntent(options.intent, options.metadata);
  if (blockers.length > 0) throw new Error(`Preflight bloqueado localmente: ${blockers.join("; ")}`);
  if (!options.apiKey || !options.apiSecret || !options.nonce) {
    throw new Error("Preflight bloqueado: faltan credenciales o nonce");
  }

  const clOrdId = crypto.randomUUID();
  const request: KrakenAddOrderRequest = {
    pair: options.intent.pair,
    type: "buy",
    ordertype: "limit",
    volume: String(options.intent.volumeBase),
    price: String(options.intent.limitPrice),
    clOrdId,
    validate: true,
  };
  const checkedAt = options.now ?? Date.now();
  const submit = options.submit ?? submitKrakenValidateOnlyOrder;

  try {
    const result = await submit({
      request: { ...request, validate: true },
      apiKey: options.apiKey,
      apiSecret: options.apiSecret,
      nonce: options.nonce,
    });
    if (result.txid.length > 0) {
      throw new Error(`VIOLACIÓN DE SEGURIDAD: Kraken devolvió txid en preflight validate-only (${result.txid.join(",")})`);
    }

    return {
      schemaVersion: "kraken-order-preflight-v1",
      checkedAt,
      validateOnly: true,
      orderCreated: false,
      accepted: true,
      krakenEvaluated: true,
      pair: options.intent.pair,
      side: "buy",
      volumeBase: options.intent.volumeBase,
      limitPrice: options.intent.limitPrice,
      notionalEur: options.intent.notionalEur,
      clOrdId,
      description: result.descr.order ?? null,
      rejectionCodes: [],
      message: "Kraken aceptó la validación estructural. No se creó ninguna orden.",
      liveTrading: false,
    };
  } catch (error) {
    if (isKrakenOrderRejection(error)) {
      return {
        schemaVersion: "kraken-order-preflight-v1",
        checkedAt,
        validateOnly: true,
        orderCreated: false,
        accepted: false,
        krakenEvaluated: true,
        pair: options.intent.pair,
        side: "buy",
        volumeBase: options.intent.volumeBase,
        limitPrice: options.intent.limitPrice,
        notionalEur: options.intent.notionalEur,
        clOrdId,
        description: null,
        rejectionCodes: [...error.codes],
        message: `Kraken rechazó el preflight sin crear orden: ${error.codes.join(", ")}`,
        liveTrading: false,
      };
    }
    throw error;
  }
}
