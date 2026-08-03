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
const MIN_FULL_CONSENSUS_PCT = 72;
const MIN_TECHNICAL_SHADOW_CONSENSUS_PCT = 100;
const MAX_XAU_EXPOSURE_PCT = 0.10;
const MAX_SPREAD_PCT = 0.08;
const SHADOW_MAX_SPREAD_PCT = 0.05;
const MIN_PROJECTED_REWARD_RISK = 2;
const SHADOW_MIN_PROJECTED_REWARD_RISK = 2.5;
const EVENT_LOCKOUT_MINUTES = 20;

function vote(expert: string, domain: string, bias: XauBias, confidence: number, reason: string): XauExpertVote {
  return { expert, domain, bias, confidence: Math.max(0, Math.min(100, confidence)), reason, veto: false };
}

function dominantBias(votes: XauExpertVote[]): XauBias {
  const score = votes.reduce((total, item) => total + (item.bias === "long" ? item.confidence : item.bias === "short" ? -item.confidence : 0), 0);
  return score > 0 ? "long" : score < 0 ? "short" : "neutral";
}

function consensus(votes: XauExpertVote[], bias: XauBias): number {
  if (bias === "neutral" || votes.length === 0) return 0;
  const total = votes.reduce((sum, item) => sum + item.confidence, 0);
  const aligned = votes.filter((item) => item.bias === bias).reduce((sum, item) => sum + item.confidence, 0);
  return total > 0 ? Math.round((aligned / total) * 10000) / 100 : 0;
}

export function evaluateXauUsdCabinet(input: XauCabinetInput): XauCabinetDecision {
  const { technical, macro } = input;
  const technicalVotes = [
    vote("Director de estructura XAU", "market-structure", technical.marketStructureBias, 88, "Estructura y cambio de carácter."),
    vote("Especialista de liquidez XAU", "liquidity", technical.liquidityBias, 84, "Liquidez y trampas de ruptura."),
    vote("Especialista de tendencia XAU", "trend", technical.trendBias, 80, "Dirección técnica dominante."),
    vote("Especialista de momentum XAU", "momentum", technical.momentumBias, 74, "Aceleración y continuidad."),
  ];
  const macroVotes = [
    vote("Especialista DXY", "dollar", macro.dxyBiasForGold, 82, "Relación con el dólar."),
    vote("Especialista de rendimientos reales", "real-yields", macro.realYieldsBiasForGold, 86, "Coste de oportunidad."),
    vote("Especialista de bancos centrales", "central-banks", macro.centralBankBias, 72, "Política monetaria."),
    vote("Especialista de inflación", "inflation", macro.inflationBias, 68, "Expectativas de inflación."),
    vote("Especialista geopolítico", "geopolitics", macro.geopoliticalBias, 76, "Demanda refugio."),
  ];
  const votes = [...technicalVotes, ...macroVotes];
  const vetoes: string[] = [];
  const reasons: string[] = [];
  const macroReady = macro.sourcesFresh >= MIN_FRESH_MACRO_SOURCES
    && (macro.sourcesAvailable === 0 || macro.sourcesFresh / macro.sourcesAvailable >= 0.6);
  const eventLockout = macro.highImpactEventWithinMinutes !== null
    && macro.highImpactEventWithinMinutes <= EVENT_LOCKOUT_MINUTES;
  const rewardRisk = technical.distanceToInvalidationPct > 0
    ? technical.projectedMovePct / technical.distanceToInvalidationPct
    : 0;
  const bias = dominantBias(macroReady ? votes : technicalVotes);
  const consensusPct = consensus(macroReady ? votes : technicalVotes, bias);
  const technicalAligned = technicalVotes.every((item) => item.bias === bias && bias !== "neutral");
  const shadowEligible = !macroReady
    && technicalAligned
    && consensusPct >= MIN_TECHNICAL_SHADOW_CONSENSUS_PCT
    && technical.spreadPct <= SHADOW_MAX_SPREAD_PCT
    && rewardRisk >= SHADOW_MIN_PROJECTED_REWARD_RISK
    && input.session !== "closed"
    && !eventLockout;

  if (input.symbol !== "XAU/USD" && input.symbol !== "XAUUSD") vetoes.push("El gabinete es exclusivo para XAU/USD.");
  if (technical.spreadPct > MAX_SPREAD_PCT) vetoes.push(`Spread XAU excesivo: ${technical.spreadPct.toFixed(3)} %.`);
  if (eventLockout) vetoes.push("Bloqueo por evento macro de alto impacto inminente.");
  if (input.paperEquityEur <= 0 || input.openXauExposureEur / input.paperEquityEur >= MAX_XAU_EXPOSURE_PCT) vetoes.push("Exposición XAU máxima alcanzada.");
  if (input.session === "closed") vetoes.push("Mercado o sesión operativa no válida.");
  if (bias === "neutral") vetoes.push("El gabinete XAU no tiene dirección dominante.");

  if (macroReady) {
    if (rewardRisk < MIN_PROJECTED_REWARD_RISK) vetoes.push(`Asimetría XAU insuficiente: ${rewardRisk.toFixed(2)}R.`);
    if (consensusPct < MIN_FULL_CONSENSUS_PCT) vetoes.push(`Consenso XAU insuficiente: ${consensusPct.toFixed(2)} %.`);
    reasons.push("Perfil completo: evidencia técnica y macro fresca.");
  } else if (shadowEligible) {
    reasons.push("Perfil PAPER técnico estricto: macro incompleta, cuatro especialistas técnicos alineados, spread reducido y asimetría mínima 2,5R.");
    reasons.push("Este perfil solo recopila evidencia PAPER; nunca habilita LIVE.");
  } else {
    vetoes.push("Evidencia macro fresca insuficiente y el perfil técnico PAPER estricto no reúne unanimidad, spread o asimetría exigidos.");
  }

  const riskRegime: XauRiskRegime = eventLockout ? "event-lockout" : technical.volatilityPct >= 1.2 ? "elevated" : "normal";
  reasons.push(`Dirección dominante: ${bias}; consenso aplicable ${consensusPct.toFixed(2)} %.`);
  reasons.push(`Relación beneficio/riesgo proyectada: ${rewardRisk.toFixed(2)}R.`);

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
    experts: ["market-structure", "liquidity", "trend", "momentum", "volatility", "DXY", "real-yields", "central-banks", "inflation", "geopolitics", "position-management", "risk"],
    mandatoryInputs: ["technical", "macro-when-available", "fresh-sources"],
    paperFallback: "strict-technical-shadow",
    executionMode: "paper-only",
    liveTrading: false,
  };
}
