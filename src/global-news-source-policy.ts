export type NewsSourceTier = "primary-official" | "regulated-market" | "professional-media" | "specialist-intelligence" | "social-lead";
export type NewsTopic =
  | "central-banks"
  | "governments"
  | "political-leaders"
  | "wars-and-sanctions"
  | "inflation-rates-gdp-employment"
  | "regulators-etf"
  | "oil-gas-gold-metals"
  | "fx-bonds-indices"
  | "cybersecurity-exchanges"
  | "whales-flows"
  | "companies-earnings";

export interface GlobalNewsSourceRule {
  id: string;
  tier: NewsSourceTier;
  examples: string[];
  topics: NewsTopic[];
  canConfirmFact: boolean;
  requiresCorroboration: boolean;
  maximumDecisionAuthority: "context-only" | "committee-input";
  rationale: string;
}

export interface GlobalNewsPolicy {
  schemaVersion: "global-news-source-policy-v1";
  rules: GlobalNewsSourceRule[];
  requiredClassification: Array<"impact" | "confidence" | "affected-assets" | "estimated-duration" | "historical-evidence" | "paper-influence">;
  safeguards: {
    noTradeFromSingleHeadline: true;
    socialPostsAreLeadsNotFacts: true;
    officialConfirmationPreferred: true;
    contradictorySourcesReduceConfidence: true;
    treasuryRetainsSizingAuthority: true;
    liveOrdersDisabled: true;
  };
  liveTrading: false;
}

export function buildGlobalNewsPolicy(): GlobalNewsPolicy {
  const rules: GlobalNewsSourceRule[] = [
    {
      id: "official-institutions",
      tier: "primary-official",
      examples: ["Fed", "BCE", "BoE", "BoJ", "SEC", "CFTC", "Eurostat", "BLS", "BEA", "EIA", "OPEP", "governments"],
      topics: ["central-banks", "governments", "wars-and-sanctions", "inflation-rates-gdp-employment", "regulators-etf", "oil-gas-gold-metals"],
      canConfirmFact: true,
      requiresCorroboration: false,
      maximumDecisionAuthority: "committee-input",
      rationale: "Fuente primaria para decisiones, comunicados, estadísticas y actuaciones regulatorias.",
    },
    {
      id: "regulated-markets-and-issuers",
      tier: "regulated-market",
      examples: ["exchange notices", "listed-company filings", "ETF issuer notices", "exchange status pages"],
      topics: ["regulators-etf", "cybersecurity-exchanges", "companies-earnings", "whales-flows"],
      canConfirmFact: true,
      requiresCorroboration: false,
      maximumDecisionAuthority: "committee-input",
      rationale: "Confirma hechos operativos, corporativos y de mercado directamente vinculados al activo.",
    },
    {
      id: "professional-financial-media",
      tier: "professional-media",
      examples: ["Reuters", "AP", "Financial Times", "Bloomberg", "Dow Jones Newswires"],
      topics: ["political-leaders", "wars-and-sanctions", "inflation-rates-gdp-employment", "oil-gas-gold-metals", "fx-bonds-indices", "companies-earnings"],
      canConfirmFact: true,
      requiresCorroboration: true,
      maximumDecisionAuthority: "committee-input",
      rationale: "Aporta velocidad y contexto, pero los hechos críticos deben contrastarse con la fuente primaria cuando exista.",
    },
    {
      id: "specialist-market-intelligence",
      tier: "specialist-intelligence",
      examples: ["on-chain analytics", "commodity intelligence", "cybersecurity researchers", "flow trackers", "sector specialists"],
      topics: ["oil-gas-gold-metals", "cybersecurity-exchanges", "whales-flows", "companies-earnings"],
      canConfirmFact: false,
      requiresCorroboration: true,
      maximumDecisionAuthority: "context-only",
      rationale: "Puede detectar antes anomalías y flujos, pero no sustituye una confirmación independiente.",
    },
    {
      id: "social-and-x-leads",
      tier: "social-lead",
      examples: ["X posts", "official social accounts", "journalist posts", "specialist accounts", "community alerts"],
      topics: ["political-leaders", "wars-and-sanctions", "regulators-etf", "cybersecurity-exchanges", "whales-flows", "companies-earnings"],
      canConfirmFact: false,
      requiresCorroboration: true,
      maximumDecisionAuthority: "context-only",
      rationale: "Canal de detección temprana. Nunca se trata como hecho confirmado ni puede disparar una operación por sí solo.",
    },
  ];

  return {
    schemaVersion: "global-news-source-policy-v1",
    rules,
    requiredClassification: ["impact", "confidence", "affected-assets", "estimated-duration", "historical-evidence", "paper-influence"],
    safeguards: {
      noTradeFromSingleHeadline: true,
      socialPostsAreLeadsNotFacts: true,
      officialConfirmationPreferred: true,
      contradictorySourcesReduceConfidence: true,
      treasuryRetainsSizingAuthority: true,
      liveOrdersDisabled: true,
    },
    liveTrading: false,
  };
}
