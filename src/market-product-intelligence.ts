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

export type AssetFamily = "crypto" | "metals" | "energy" | "indices" | "forex" | "equities" | "etfs";

export interface AssetFamilySpecialist {
  id: string;
  family: AssetFamily;
  label: string;
  markets: string[];
  requiredSignals: string[];
  dominantRisks: string[];
  preferredHorizons: string[];
  dataAvailability: "native-kraken" | "tokenized-proxy" | "external-feed-required";
  paperAuthority: "active" | "observe-only";
  mayTradeLive: false;
}

export interface MarketProductIntelligence {
  schemaVersion: "kraken-product-intelligence-v1";
  generatedAt: number;
  routes: KrakenProductRoute[];
  paperActive: number;
  observedOnly: number;
  blocked: number;
  specialists: AssetFamilySpecialist[];
  dynamicSelection: {
    enabledForResearch: true;
    rankingInputs: string[];
    requiresComparableLiveData: true;
    mayForceTrade: false;
    mayIncreaseRiskForVolatility: false;
    treasuryRetainsSizingAuthority: true;
  };
  coverage: {
    declaredFamilies: number;
    nativeOrProxyFamilies: number;
    externalFeedFamilies: number;
  };
  policy: {
    discoversBroadMarket: true;
    tradesOnlyValidatedSpot: true;
    leverageHardBlocked: true;
    realOrdersDisabled: true;
  };
  eligibleForLiveReview: false;
  liveTrading: false;
}

function buildSpecialists(): AssetFamilySpecialist[] {
  return [
    {
      id: "director-crypto",
      family: "crypto",
      label: "Director de Criptoactivos",
      markets: ["BTC", "ETH", "SOL", "principales altcoins y pares líquidos"],
      requiredSignals: ["estructura multitemporal", "volumen", "liquidez", "spread", "volatilidad útil", "flujo de exchanges", "noticias cripto"],
      dominantRisks: ["falsas rupturas", "fragmentación de liquidez", "hackeos", "movimientos 24/7"],
      preferredHorizons: ["segundos", "minutos", "horas"],
      dataAvailability: "native-kraken",
      paperAuthority: "active",
      mayTradeLive: false,
    },
    {
      id: "director-metales",
      family: "metals",
      label: "Director de Metales",
      markets: ["oro", "plata", "platino", "paladio"],
      requiredSignals: ["estructura técnica", "dólar", "tipos reales", "bonos", "inflación", "flujos refugio"],
      dominantRisks: ["noticias macro", "spikes de liquidez", "coste del proxy tokenizado"],
      preferredHorizons: ["minutos", "horas", "días"],
      dataAvailability: "tokenized-proxy",
      paperAuthority: "active",
      mayTradeLive: false,
    },
    {
      id: "director-energia",
      family: "energy",
      label: "Director de Energía",
      markets: ["WTI", "Brent", "gas natural"],
      requiredSignals: ["tendencia", "inventarios", "OPEP+", "geopolítica", "curva de futuros", "dólar"],
      dominantRisks: ["gaps", "titulares inesperados", "roll y contango", "apalancamiento implícito del producto"],
      preferredHorizons: ["minutos", "horas", "días"],
      dataAvailability: "external-feed-required",
      paperAuthority: "observe-only",
      mayTradeLive: false,
    },
    {
      id: "director-indices",
      family: "indices",
      label: "Director de Índices Mundiales",
      markets: ["S&P 500", "Nasdaq", "DAX", "IBEX 35", "Nikkei", "Hang Seng"],
      requiredSignals: ["amplitud", "volatilidad", "futuros", "bonos", "macro", "sesión regional"],
      dominantRisks: ["gaps de apertura", "eventos macro", "concentración sectorial"],
      preferredHorizons: ["minutos", "horas", "días"],
      dataAvailability: "external-feed-required",
      paperAuthority: "observe-only",
      mayTradeLive: false,
    },
    {
      id: "director-forex",
      family: "forex",
      label: "Director de Divisas",
      markets: ["EUR/USD", "USD/JPY", "GBP/USD", "principales cruces"],
      requiredSignals: ["diferencial de tipos", "bancos centrales", "inflación", "empleo", "liquidez por sesión"],
      dominantRisks: ["intervenciones", "datos macro", "spreads fuera de horario"],
      preferredHorizons: ["minutos", "horas", "días"],
      dataAvailability: "external-feed-required",
      paperAuthority: "observe-only",
      mayTradeLive: false,
    },
    {
      id: "director-equities",
      family: "equities",
      label: "Director de Acciones",
      markets: ["grandes compañías líquidas de EE. UU., Europa y Asia"],
      requiredSignals: ["resultados", "guidance", "valoración", "volumen", "sector", "noticias corporativas"],
      dominantRisks: ["gaps", "resultados", "suspensiones", "riesgo idiosincrático"],
      preferredHorizons: ["horas", "días", "semanas"],
      dataAvailability: "external-feed-required",
      paperAuthority: "observe-only",
      mayTradeLive: false,
    },
    {
      id: "director-etfs",
      family: "etfs",
      label: "Director de ETFs",
      markets: ["índices", "sectores", "bonos", "materias primas"],
      requiredSignals: ["tracking", "liquidez", "spread", "flujos", "tendencia", "riesgo del subyacente"],
      dominantRisks: ["tracking error", "liquidez intradía", "estructura sintética"],
      preferredHorizons: ["horas", "días", "semanas"],
      dataAvailability: "external-feed-required",
      paperAuthority: "observe-only",
      mayTradeLive: false,
    },
  ];
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
  const specialists = buildSpecialists();
  return {
    schemaVersion: "kraken-product-intelligence-v1",
    generatedAt: now,
    routes,
    paperActive: routes.filter((route) => route.status === "paper-active").length,
    observedOnly: routes.filter((route) => route.status === "paper-observe").length,
    blocked: routes.filter((route) => route.status === "blocked").length,
    specialists,
    dynamicSelection: {
      enabledForResearch: true,
      rankingInputs: ["liquidez", "spread", "volatilidad útil", "tendencia frente a ruido", "costes", "noticias", "correlaciones", "evidencia por familia"],
      requiresComparableLiveData: true,
      mayForceTrade: false,
      mayIncreaseRiskForVolatility: false,
      treasuryRetainsSizingAuthority: true,
    },
    coverage: {
      declaredFamilies: specialists.length,
      nativeOrProxyFamilies: specialists.filter((specialist) => specialist.dataAvailability !== "external-feed-required").length,
      externalFeedFamilies: specialists.filter((specialist) => specialist.dataAvailability === "external-feed-required").length,
    },
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
