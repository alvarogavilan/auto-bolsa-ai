export type XauBias = "long" | "short" | "neutral";
export type XauSession = "asia" | "london" | "new-york" | "overlap" | "closed";
export type XauRiskRegime = "normal" | "elevated" | "event-lockout";

export interface XauTechnicalEvidence {
  trendBias: XauBias;
  marketStructureBias: XauBias;
  liquidityBias: XauBias;
  momentumBias: XauBias;
  volatilityPct: number;
  spreadPct: number;
  distanceToInvalidationPct: number;
  projectedMovePct: number;
}

export interface XauMacroEvidence {
  dxyBiasForGold: XauBias;
  realYieldsBiasForGold: XauBias;
  centralBankBias: XauBias;
  inflationBias: XauBias;
  geopoliticalBias: XauBias;
  highImpactEventWithinMinutes: number | null;
  sourcesAvailable: number;
  sourcesFresh: number;
}

export interface XauCabinetInput {
  symbol: string;
  session: XauSession;
  technical: XauTechnicalEvidence;
  macro: XauMacroEvidence;
  openXauExposureEur: number;
  paperEquityEur: number;
}

export interface XauExpertVote {
  expert: string;
  domain: string;
  bias: XauBias;
  confidence: number;
  veto: boolean;
  reason: string;
}

export interface XauCabinetDecision {
  schemaVersion: "xau-usd-specialist-cabinet-v1";
  symbol: "XAU/USD";
  allowed: boolean;
  bias: XauBias;
  consensusPct: number;
  riskRegime: XauRiskRegime;
  votes: XauExpertVote[];
  vetoes: string[];
  reasons: string[];
  liveTrading: false;
}

const MIN_FRESH_MACRO_SOURCES = 3;
const MIN_CONSENSUS_PCT = 72;
const MAX_XAU_EXPOSURE_PCT = 0.10;
const MAX_SPREAD_PCT = 0.08;
const MIN_PROJECTED_REWARD_RISK = 2;
const EVENT_LOCKOUT_MINUTES = 20;

function vote(expert: string, domain: string, bias: XauBias, confidence: number, reason: string, veto = false): XauExpertVote {
  return { expert, domain, bias, confidence: Math.max(0, Math.min(100, confidence)), reason, veto };
}

function dominantBias(votes: XauExpertVote[]): XauBias {
  const score = votes.reduce((total, item) => total + (item.bias === "long" ? item.confidence : item.bias === "short" ? -item.confidence : 0), 0);
  if (score > 0) return "long";
  if (score < 0) return "short";
  return "neutral";
}

export function evaluateXauUsdCabinet(input: XauCabinetInput): XauCabinetDecision {
  const votes: XauExpertVote[] = [];
  const vetoes: string[] = [];
  const reasons: string[] = [];
  const { technical, macro } = input;

  votes.push(vote("Director de estructura XAU", "market-structure", technical.marketStructureBias, 88, "Estructura, máximos, mínimos y cambio de carácter."));
  votes.push(vote("Especialista de liquidez XAU", "liquidity", technical.liquidityBias, 84, "Barridos, zonas de liquidez y trampas de ruptura."));
  votes.push(vote("Especialista de tendencia XAU", "trend", technical.trendBias, 80, "Dirección técnica dominante multitemporal."));
  votes.push(vote("Especialista de momentum XAU", "momentum", technical.momentumBias, 74, "Aceleración y continuidad del movimiento."));
  votes.push(vote("Especialista DXY", "dollar", macro.dxyBiasForGold, 82, "Relación inversa con fortaleza del dólar."));
  votes.push(vote("Especialista de rendimientos reales", "real-yields", macro.realYieldsBiasForGold, 86, "Coste de oportunidad del oro frente a bonos reales."));
  votes.push(vote("Especialista de bancos centrales", "central-banks", macro.centralBankBias, 72, "Política monetaria y demanda institucional."));
  votes.push(vote("Especialista de inflación", "inflation", macro.inflationBias, 68, "Expectativas de inflación y protección de valor."));
  votes.push(vote("Especialista geopolítico", "geopolitics", macro.geopoliticalBias, 76, "Demanda refugio por conflicto o estrés sistémico."));

  if (input.symbol !== "XAU/USD" && input.symbol !== "XAUUSD") vetoes.push("El gabinete es exclusivo para XAU/USD.");
  if (technical.spreadPct > MAX_SPREAD_PCT) vetoes.push(`Spread XAU excesivo: ${technical.spreadPct.toFixed(3)} %.`);
  if (macro.sourcesFresh < MIN_FRESH_MACRO_SOURCES) vetoes.push("Evidencia macro fresca insuficiente para operar oro.");
  if (macro.sourcesAvailable > 0 && macro.sourcesFresh / macro.sourcesAvailable < 0.6) vetoes.push("La mayoría de fuentes macro están caducadas.");
  if (macro.highImpactEventWithinMinutes !== null && macro.highImpactEventWithinMinutes <= EVENT_LOCKOUT_MINUTES) vetoes.push("Bloqueo por evento macro de alto impacto inminente.");
  if (input.paperEquityEur <= 0 || input.openXauExposureEur / input.paperEquityEur >= MAX_XAU_EXPOSURE_PCT) vetoes.push("Exposición XAU máxima alcanzada.");

  const rewardRisk = technical.distanceToInvalidationPct > 0
    ? technical.projectedMovePct / technical.distanceToInvalidationPct
    : 0;
  if (rewardRisk < MIN_PROJECTED_REWARD_RISK) vetoes.push(`Asimetría XAU insuficiente: ${rewardRisk.toFixed(2)}R.`);
  if (input.session === "closed") vetoes.push("Mercado o sesión operativa no válida.");

  const bias = dominantBias(votes);
  const aligned = votes.filter((item) => item.bias === bias && bias !== "neutral");
  const totalConfidence = votes.reduce((sum, item) => sum + item.confidence, 0);
  const alignedConfidence = aligned.reduce((sum, item) => sum + item.confidence, 0);
  const consensusPct = totalConfidence > 0 ? Math.round((alignedConfidence / totalConfidence) * 10000) / 100 : 0;

  if (bias === "neutral") vetoes.push("El gabinete XAU no tiene dirección dominante.");
  if (consensusPct < MIN_CONSENSUS_PCT) vetoes.push(`Consenso XAU insuficiente: ${consensusPct.toFixed(2)} %.`);

  const eventLockout = macro.highImpactEventWithinMinutes !== null && macro.highImpactEventWithinMinutes <= EVENT_LOCKOUT_MINUTES;
  const riskRegime: XauRiskRegime = eventLockout ? "event-lockout" : technical.volatilityPct >= 1.2 ? "elevated" : "normal";

  reasons.push(`Gabinete exclusivo XAU/USD: ${votes.length} especialistas.`);
  reasons.push(`Dirección dominante: ${bias}; consenso ${consensusPct.toFixed(2)} %.`);
  reasons.push(`Relación beneficio/riesgo proyectada: ${rewardRisk.toFixed(2)}R.`);
  reasons.push(`Sesión: ${input.session}; régimen de riesgo: ${riskRegime}.`);

  return {
    schemaVersion: "xau-usd-specialist-cabinet-v1",
    symbol: "XAU/USD",
    allowed: vetoes.length === 0,
    bias,
    consensusPct,
    riskRegime,
    votes,
    vetoes,
    reasons,
    liveTrading: false,
  };
}

export function buildXauUsdCabinetManifest(): Record<string, unknown> {
  return {
    schemaVersion: "xau-usd-specialist-cabinet-manifest-v1",
    market: "XAU/USD",
    exclusive: true,
    priority: "maximum",
    experts: [
      "market-structure",
      "liquidity",
      "trend",
      "momentum",
      "volatility",
      "DXY",
      "real-yields",
      "central-banks",
      "inflation",
      "geopolitics",
      "session-asia",
      "session-london",
      "session-new-york",
      "position-management",
      "risk",
    ],
    mandatoryInputs: ["technical", "DXY", "real-yields", "macro-events", "geopolitics", "fresh-sources"],
    executionMode: "paper-only",
    liveTrading: false,
  };
}
