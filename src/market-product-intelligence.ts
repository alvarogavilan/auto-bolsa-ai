export type ProductResearchStatus = "paper-active" | "paper-observe" | "blocked";

export interface KrakenProductRoute {
  id: string;
  label: string;
  family: "spot" | "margin" | "futures" | "staking" | "fx" | "tokenized-asset";
  status: ProductResearchStatus;
  dataMode: "live-public" | "catalog-only";
  capitalCompatible: boolean;
  leverage: boolean;
  liquidationRisk: boolean;
  rationale: string;
}

export interface MarketProductIntelligence {
  schemaVersion: "kraken-product-intelligence-v1";
  generatedAt: number;
  routes: KrakenProductRoute[];
  paperActive: number;
  observedOnly: number;
  blocked: number;
  policy: {
    discoversBroadMarket: true;
    tradesOnlyValidatedSpot: true;
    leverageHardBlocked: true;
    realOrdersDisabled: true;
  };
  eligibleForLiveReview: false;
  liveTrading: false;
}

export function buildMarketProductIntelligence(now = Date.now()): MarketProductIntelligence {
  const routes: KrakenProductRoute[] = [
    {
      id: "spot-eur",
      label: "Spot con cotización EUR",
      family: "spot",
      status: "paper-active",
      dataMode: "live-public",
      capitalCompatible: true,
      leverage: false,
      liquidationRisk: false,
      rationale: "Ruta principal: capital pequeño, sin apalancamiento y con contabilidad directa en EUR.",
    },
    {
      id: "spot-cross-quote",
      label: "Spot con USD, USDT, USDC, BTC y otras cotizaciones",
      family: "spot",
      status: "paper-observe",
      dataMode: "live-public",
      capitalCompatible: false,
      leverage: false,
      liquidationRisk: false,
      rationale: "Se estudia todo el universo, pero exige conversión y contabilidad multicurrency antes de operar.",
    },
    {
      id: "tokenized-assets",
      label: "Activos tokenizados como XAUT",
      family: "tokenized-asset",
      status: "paper-active",
      dataMode: "live-public",
      capitalCompatible: true,
      leverage: false,
      liquidationRisk: false,
      rationale: "Se activa en PAPER cuando mínimos, liquidez, spread y recorrido superan los costes.",
    },
    {
      id: "spot-margin",
      label: "Spot con margen",
      family: "margin",
      status: "blocked",
      dataMode: "catalog-only",
      capitalCompatible: false,
      leverage: true,
      liquidationRisk: true,
      rationale: "Puede observarse para investigación, pero queda excluido por apalancamiento y liquidación.",
    },
    {
      id: "perpetual-and-futures",
      label: "Futuros y perpetuos",
      family: "futures",
      status: "blocked",
      dataMode: "catalog-only",
      capitalCompatible: false,
      leverage: true,
      liquidationRisk: true,
      rationale: "Requiere un motor, cuenta, garantías y controles separados; no puede heredar seguridad de spot.",
    },
    {
      id: "fx-stablecoin",
      label: "Divisas y stablecoins",
      family: "fx",
      status: "paper-observe",
      dataMode: "live-public",
      capitalCompatible: true,
      leverage: false,
      liquidationRisk: false,
      rationale: "Útiles para estudiar refugio, liquidez, correlaciones y coste de conversión; recorrido absoluto limitado.",
    },
    {
      id: "staking-earn",
      label: "Staking y Earn",
      family: "staking",
      status: "blocked",
      dataMode: "catalog-only",
      capitalCompatible: true,
      leverage: false,
      liquidationRisk: false,
      rationale: "No es compraventa ni pertenece al motor de señales; requeriría evaluación jurídica y operativa separada.",
    },
  ];
  return {
    schemaVersion: "kraken-product-intelligence-v1",
    generatedAt: now,
    routes,
    paperActive: routes.filter((route) => route.status === "paper-active").length,
    observedOnly: routes.filter((route) => route.status === "paper-observe").length,
    blocked: routes.filter((route) => route.status === "blocked").length,
    policy: {
      discoversBroadMarket: true,
      tradesOnlyValidatedSpot: true,
      leverageHardBlocked: true,
      realOrdersDisabled: true,
    },
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
