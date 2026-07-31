import {
  addOrder,
  isKrakenOrderRejection,
  type KrakenAddOrderRequest,
  type KrakenAddOrderResult,
} from "./kraken";
import {
  validateOrderIntent,
  type LivePairMetadata,
} from "./live-guardrails";

export const PREFLIGHT_MAX_NOTIONAL_EUR = 5;

export interface LiveOrderPreflightIntent {
  pair: string;
  side: "buy" | "sell";
  volumeBase: number;
  limitPrice: number;
  notionalEur: number;
}

export interface LiveOrderPreflightConstraints {
  pairMetadata: Readonly<Record<string, LivePairMetadata>>;
  maxNotionalEur?: number;
  maxNotionalDeviationPct?: number;
}

export interface ValidateOnlyOrderGateway {
  validate(request: Readonly<KrakenAddOrderRequest>): Promise<KrakenAddOrderResult>;
}

export type LiveOrderPreflightStatus = "validated" | "rejected" | "unknown";

export interface LiveOrderPreflightResult {
  status: LiveOrderPreflightStatus;
  checkedAt: number;
  contactedKraken: boolean;
  validateFlagForced: true;
  matchingEngineSubmission: false | null;
  realOrderCreated: false | null;
  clOrdId: string | null;
  blockers: string[];
  message: string;
  description: string | null;
  anomaly: string | null;
}

export interface RunLiveOrderPreflightOptions {
  now?: number;
  clOrdIdFactory?: () => string;
}

/**
 * Pasarela real y deliberadamente separada de `LiveOrderTransport.createOrder`.
 * El indicador `validate` se fija aquí y no procede del llamador. Esta clase no
 * está conectada a ninguna ruta, cron o Durable Object en producción.
 */
export class KrakenValidateOnlyOrderGateway implements ValidateOnlyOrderGateway {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  async validate(request: Readonly<KrakenAddOrderRequest>): Promise<KrakenAddOrderResult> {
    const nonce = await this.nextNonce();
    return addOrder(
      {
        pair: request.pair,
        type: request.type,
        ordertype: request.ordertype,
        volume: request.volume,
        price: request.price,
        clOrdId: request.clOrdId,
        // Invariante de seguridad: el llamador no puede desactivar esta marca.
        validate: true,
      },
      this.apiKey,
      this.apiSecret,
      nonce,
    );
  }
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function localBlockers(
  intent: LiveOrderPreflightIntent,
  constraints: LiveOrderPreflightConstraints,
): string[] {
  const blockers = validateOrderIntent(
    {
      pair: intent.pair,
      volumeBase: intent.volumeBase,
      limitPrice: intent.limitPrice,
      notionalEur: intent.notionalEur,
    },
    {
      pairMetadata: constraints.pairMetadata,
      maxNotionalDeviationPct: constraints.maxNotionalDeviationPct ?? 0.01,
    },
  );

  const maxNotional = constraints.maxNotionalEur ?? PREFLIGHT_MAX_NOTIONAL_EUR;
  if (!finitePositive(maxNotional)) blockers.push("El máximo de preflight debe ser positivo y finito");
  if (finitePositive(intent.notionalEur) && finitePositive(maxNotional) && intent.notionalEur > maxNotional) {
    blockers.push(`El preflight supera el máximo permitido de ${maxNotional} EUR`);
  }

  return blockers;
}

/**
 * Valida una intención con reglas locales y después con Kraken en modo
 * `validate=true`. Nunca comparte el camino que crea órdenes reales.
 *
 * Una respuesta que contenga cualquier `txid` se considera una anomalía
 * crítica: no se interpreta como éxito aunque Kraken no devuelva error.
 */
export async function runLiveOrderPreflight(
  intent: LiveOrderPreflightIntent,
  constraints: LiveOrderPreflightConstraints,
  gateway: ValidateOnlyOrderGateway,
  options: RunLiveOrderPreflightOptions = {},
): Promise<LiveOrderPreflightResult> {
  const now = options.now ?? Date.now();
  const blockers = localBlockers(intent, constraints);
  if (blockers.length > 0) {
    return {
      status: "rejected",
      checkedAt: now,
      contactedKraken: false,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      clOrdId: null,
      blockers,
      message: "La intención fue bloqueada localmente antes de contactar con Kraken.",
      description: null,
      anomaly: null,
    };
  }

  const clOrdId = (options.clOrdIdFactory ?? crypto.randomUUID)();
  const request: KrakenAddOrderRequest = {
    pair: intent.pair,
    type: intent.side,
    ordertype: "limit",
    volume: String(intent.volumeBase),
    price: String(intent.limitPrice),
    clOrdId,
    validate: true,
  };

  try {
    const response = await gateway.validate(request);
    if (response.txid.length > 0) {
      return {
        status: "unknown",
        checkedAt: now,
        contactedKraken: true,
        validateFlagForced: true,
        matchingEngineSubmission: null,
        realOrderCreated: null,
        clOrdId,
        blockers: ["Kraken devolvió un txid inesperado en una validación sin ejecución"],
        message: "Anomalía crítica: el preflight no puede certificarse como seguro.",
        description: response.descr.order ?? null,
        anomaly: `unexpected_txid:${response.txid.join(",")}`,
      };
    }

    return {
      status: "validated",
      checkedAt: now,
      contactedKraken: true,
      validateFlagForced: true,
      matchingEngineSubmission: false,
      realOrderCreated: false,
      clOrdId,
      blockers: [],
      message: "Kraken validó la orden en modo validate-only sin crearla.",
      description: response.descr.order ?? null,
      anomaly: null,
    };
  } catch (error) {
    if (isKrakenOrderRejection(error)) {
      return {
        status: "rejected",
        checkedAt: now,
        contactedKraken: true,
        validateFlagForced: true,
        matchingEngineSubmission: false,
        realOrderCreated: false,
        clOrdId,
        blockers: [...error.codes],
        message: "Kraken evaluó y rechazó la orden de validación.",
        description: null,
        anomaly: null,
      };
    }

    const message = error instanceof Error ? error.message : "Fallo desconocido durante el preflight";
    return {
      status: "unknown",
      checkedAt: now,
      contactedKraken: true,
      validateFlagForced: true,
      // En un fallo de red o autenticación no se afirma un resultado que no se recibió.
      matchingEngineSubmission: null,
      realOrderCreated: null,
      clOrdId,
      blockers: [message],
      message: "No se pudo certificar el resultado del preflight.",
      description: null,
      anomaly: "unverified_transport_result",
    };
  }
}
