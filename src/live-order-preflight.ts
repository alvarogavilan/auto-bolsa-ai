import {
  fetchBalance,
  isKrakenOrderRejection,
  openOrders,
  type KrakenAddOrderRequest,
  type KrakenAddOrderResult,
} from "./kraken";
import { addKrakenFokLimitOrder } from "./kraken-fok-order";
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

export interface KrakenAccountCleanlinessAudit {
  schemaVersion: "kraken-account-cleanliness-v1";
  checkedAt: number;
  eurBalance: number | null;
  nonZeroAssetCount: number;
  nonEurAssetCount: number;
  openOrderCount: number;
  accountCleanForBaseline: boolean;
  blockers: string[];
  nonceRequests: 2;
  networkCallsToKraken: 2;
  readOnly: true;
  realOrderCreated: false;
  liveTrading: false;
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
 * Copia exclusivamente los campos permitidos y fuerza `validate:true`.
 * Aunque un futuro llamador entregue `validate:false`, nunca alcanza Kraken.
 */
export function forceValidateOnlyOrderRequest(
  request: Readonly<KrakenAddOrderRequest>,
): KrakenAddOrderRequest {
  const forced: KrakenAddOrderRequest = {
    pair: request.pair,
    type: request.type,
    ordertype: request.ordertype,
    volume: request.volume,
    clOrdId: request.clOrdId,
    validate: true,
  };
  if (request.price !== undefined) forced.price = request.price;
  return forced;
}

/**
 * Pasarela real y deliberadamente separada de `LiveOrderTransport.createOrder`.
 * Tanto validate-only como el envío LIVE usan limit + FOK a través de la misma
 * implementación de Kraken, de modo que el certificado valida la semántica
 * exacta que después puede alcanzar el matching engine.
 */
export class KrakenValidateOnlyOrderGateway implements ValidateOnlyOrderGateway {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  async validate(request: Readonly<KrakenAddOrderRequest>): Promise<KrakenAddOrderResult> {
    const forced = forceValidateOnlyOrderRequest(request);
    if (forced.ordertype !== "limit" || forced.price === undefined) {
      throw new Error("El preflight LIVE exige una orden limit con precio explícito");
    }
    const nonce = await this.nextNonce();
    return addKrakenFokLimitOrder({
      pair: forced.pair,
      type: forced.type,
      volume: forced.volume,
      price: forced.price,
      clOrdId: forced.clOrdId,
      validate: true,
    }, this.apiKey, this.apiSecret, nonce);
  }
}

/**
 * Pasarela estrictamente de lectura para comprobar que la cuenta no contiene
 * inventario previo ni órdenes abiertas antes de calibrar un piloto. Solicita
 * dos nonces secuenciales a la misma autoridad: primero Balance y después
 * OpenOrders. No expone ningún método capaz de crear, cancelar o modificar.
 */
export class KrakenReadOnlyAccountGateway {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nextNonce: () => Promise<string>,
  ) {}

  async audit(now = Date.now()): Promise<KrakenAccountCleanlinessAudit> {
    const balanceNonce = await this.nextNonce();
    const balances = await fetchBalance(
      this.apiKey,
      this.apiSecret,
      balanceNonce,
    );

    const openOrdersNonce = await this.nextNonce();
    const orders = await openOrders(
      this.apiKey,
      this.apiSecret,
      openOrdersNonce,
    );

    const nonZero = Object.entries(balances).filter(([, raw]) => {
      const value = Number(raw);
      return Number.isFinite(value) && Math.abs(value) > 0.000000000001;
    });
    const nonEur = nonZero.filter(([asset]) => asset !== "EUR" && asset !== "ZEUR");
    const eurRaw = balances.ZEUR ?? balances.EUR;
    const eurParsed = eurRaw === undefined ? null : Number(eurRaw);
    const eurBalance = eurParsed !== null && Number.isFinite(eurParsed) ? eurParsed : null;
    const blockers: string[] = [];
    if (nonEur.length > 0) blockers.push("La cuenta contiene activos no EUR antes del baseline");
    if (orders.length > 0) blockers.push("La cuenta contiene órdenes abiertas antes del baseline");

    return {
      schemaVersion: "kraken-account-cleanliness-v1",
      checkedAt: now,
      eurBalance,
      nonZeroAssetCount: nonZero.length,
      nonEurAssetCount: nonEur.length,
      openOrderCount: orders.length,
      accountCleanForBaseline: blockers.length === 0,
      blockers,
      nonceRequests: 2,
      networkCallsToKraken: 2,
      readOnly: true,
      realOrderCreated: false,
      liveTrading: false,
    };
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
 * `validate=true`. Nunca comparte credenciales con el camino que crea órdenes
 * reales, pero sí comparte la forma exacta limit + FOK.
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

  const clOrdId = options.clOrdIdFactory ? options.clOrdIdFactory() : crypto.randomUUID();
  const request = forceValidateOnlyOrderRequest({
    pair: intent.pair,
    type: intent.side,
    ordertype: "limit",
    volume: String(intent.volumeBase),
    price: String(intent.limitPrice),
    clOrdId,
    validate: false,
  });

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
      message: "Kraken validó la orden limit FOK en modo validate-only sin crearla.",
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
        message: "Kraken evaluó y rechazó la orden FOK de validación.",
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
      matchingEngineSubmission: null,
      realOrderCreated: null,
      clOrdId,
      blockers: [message],
      message: "No se pudo certificar el resultado del preflight FOK.",
      description: null,
      anomaly: "unverified_transport_result",
    };
  }
}