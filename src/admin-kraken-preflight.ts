import {
  KrakenValidateOnlyOrderGateway,
  runLiveOrderPreflight,
  type LiveOrderPreflightResult,
  type ValidateOnlyOrderGateway,
} from "./live-order-preflight";
import {
  createLivePreflightCertificate,
  type LivePreflightCertificate,
} from "./live-preflight-certificate";
import {
  fetchAllTickers,
  fetchTradableAssetPairs,
  type KrakenAssetPair,
  type KrakenTicker,
} from "./kraken-markets";
import { resolveLivePairResolution } from "./live-pair-metadata";
import { buildValidateOnlyBuyPlan, type ValidateOnlyBuyPlan } from "./live-preflight-plan";

export interface AdminKrakenPreflightConfig {
  apiKey: string;
  apiSecret: string;
  pair: string;
  /** Identificador de la orden preparada que deberá reutilizar el envío futuro. */
  clOrdId: string;
  nextNonce: () => Promise<string>;
  now?: number;
}

export interface AdminKrakenPreflightDependencies {
  fetchPairs?: () => Promise<KrakenAssetPair[]>;
  fetchTickers?: () => Promise<Record<string, KrakenTicker>>;
  gatewayFactory?: (
    apiKey: string,
    apiSecret: string,
    nextNonce: () => Promise<string>,
  ) => ValidateOnlyOrderGateway;
}

export interface AdminKrakenPreflightReport {
  schemaVersion: "admin-kraken-preflight-v2";
  checkedAt: number;
  configured: true;
  pair: string;
  clOrdId: string;
  publicDataVerified: true;
  preflightComplete: boolean;
  plan: ValidateOnlyBuyPlan;
  result: LiveOrderPreflightResult;
  certificate: LivePreflightCertificate | null;
  orderCreated: false | null;
  liveTrading: false;
  message: string;
}

function tickerForPair(
  tickers: Readonly<Record<string, KrakenTicker>>,
  canonicalPair: string,
  aliases: readonly string[],
): KrakenTicker {
  const direct = tickers[canonicalPair];
  if (direct) return direct;
  for (const alias of aliases) {
    const ticker = tickers[alias];
    if (ticker) return ticker;
  }
  throw new Error(`Kraken Ticker no contiene el par ${canonicalPair}`);
}

/**
 * Servicio aislado para el futuro botón admin. Solo usa datos públicos para
 * construir la intención y una pasarela AddOrder que fuerza validate=true.
 * El mismo `clOrdId` de la orden preparada se utiliza en Kraken y queda ligado
 * al certificado de un solo uso. No conoce rutas HTTP ni activa LIVE.
 */
export async function runAdminKrakenValidateOnlyPreflight(
  config: AdminKrakenPreflightConfig,
  dependencies: AdminKrakenPreflightDependencies = {},
): Promise<AdminKrakenPreflightReport> {
  if (!config.apiKey || !config.apiSecret) throw new Error("Faltan credenciales Kraken para el preflight");
  if (!config.pair.trim()) throw new Error("Falta el par configurado para el preflight");
  if (!config.clOrdId.trim()) throw new Error("Falta el clOrdId preparado para el preflight");

  const fetchPairs = dependencies.fetchPairs ?? fetchTradableAssetPairs;
  const fetchTickers = dependencies.fetchTickers ?? fetchAllTickers;
  const gatewayFactory = dependencies.gatewayFactory
    ?? ((apiKey, apiSecret, nextNonce) => new KrakenValidateOnlyOrderGateway(apiKey, apiSecret, nextNonce));

  const [pairs, tickers] = await Promise.all([fetchPairs(), fetchTickers()]);
  const resolution = resolveLivePairResolution(pairs, config.pair);
  const pairInfo = pairs.find((candidate) => candidate.key === resolution.canonicalPair);
  if (!pairInfo) throw new Error(`No se pudo recuperar costmin para ${resolution.canonicalPair}`);

  const ticker = tickerForPair(tickers, resolution.canonicalPair, resolution.acceptedPairCodes);
  const plan = buildValidateOnlyBuyPlan({
    pair: config.pair,
    askPrice: ticker.ask,
    metadata: resolution.metadata,
    costMinQuote: pairInfo.costmin,
  });

  const gateway = gatewayFactory(config.apiKey, config.apiSecret, config.nextNonce);
  const checkedAt = config.now ?? Date.now();
  const result = await runLiveOrderPreflight(
    plan.intent,
    {
      pairMetadata: { [config.pair]: resolution.metadata },
      maxNotionalEur: plan.maxNotionalEur,
      maxNotionalDeviationPct: 0.01,
    },
    gateway,
    {
      now: checkedAt,
      clOrdIdFactory: () => config.clOrdId,
    },
  );

  const certificate = result.status === "validated"
    ? await createLivePreflightCertificate(plan.intent, result)
    : null;

  return {
    schemaVersion: "admin-kraken-preflight-v2",
    checkedAt,
    configured: true,
    pair: config.pair,
    clOrdId: config.clOrdId,
    publicDataVerified: true,
    preflightComplete: result.status !== "unknown",
    plan,
    result,
    certificate,
    orderCreated: result.realOrderCreated,
    liveTrading: false,
    message: result.status === "validated"
      ? "Preflight completado: Kraken validó la compra límite y se emitió un certificado de un solo uso."
      : result.status === "rejected"
        ? "Preflight completado: Kraken evaluó y rechazó la compra sin crearla."
        : "Preflight no certificable: no se emitió certificado ni se repetirá hasta revisar el fallo.",
  };
}
