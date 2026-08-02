export type VerificationTier = "internally-reproducible" | "audited-public-record" | "public-disclosure-only" | "unverified-claim";

export interface InstitutionalReference {
  id: string;
  label: string;
  category: "cash" | "buy-hold" | "equal-weight" | "risk-parity" | "professional-disclosure" | "broker-report" | "public-wallet";
  verification: VerificationTier;
  copyTradingAllowed: false;
  comparisonWeight: number;
  usableForDecisionContext: boolean;
  use: string;
}

export interface ProfessionalClaimAssessment {
  claim: string;
  verification: VerificationTier;
  acceptedAsEvidence: boolean;
  weight: number;
  blockers: string[];
}

export interface InstitutionalIntelligenceReport {
  schemaVersion: "institutional-intelligence-v2";
  generatedAt: number;
  references: InstitutionalReference[];
  professionalClaimPolicy: {
    claimedPerfectWinRateIsEvidence: false;
    minimumClosedTrades: number;
    fullHistoryRequired: true;
    timestampsRequired: true;
    costsRequired: true;
    openPositionsRequired: true;
    depositsAndWithdrawalsRequired: true;
    independentVerificationPreferred: true;
  };
  claimExamples: ProfessionalClaimAssessment[];
  comparisonRules: string[];
  safeguards: {
    noCopyTrading: true;
    noUnverifiedWinRates: true;
    noSignalAuthorityForThirdParties: true;
    survivorshipBiasWarning: true;
    netOfCostsRequired: true;
    liveTrading: false;
  };
  benchmarkSnapshot: unknown;
  committeeSnapshot: unknown;
  eligibleForLiveReview: false;
  liveTrading: false;
}

function assessClaim(claim: string, evidence: { fullHistory?: boolean; audited?: boolean; trades?: number; costs?: boolean; openPositions?: boolean; timestamps?: boolean } = {}): ProfessionalClaimAssessment {
  const blockers: string[] = [];
  if (!evidence.fullHistory) blockers.push("No consta el historial completo, incluidas operaciones eliminadas o no publicadas.");
  if (!evidence.timestamps) blockers.push("No hay timestamps verificables de entrada y salida.");
  if (!evidence.costs) blockers.push("No incluye comisiones, spread, financiación y deslizamiento.");
  if (!evidence.openPositions) blockers.push("No incluye posiciones abiertas ni pérdidas no realizadas.");
  if ((evidence.trades ?? 0) < 30) blockers.push("Muestra inferior a 30 operaciones cerradas.");
  const audited = evidence.audited === true && blockers.length === 0;
  return {
    claim,
    verification: audited ? "audited-public-record" : "unverified-claim",
    acceptedAsEvidence: audited,
    weight: audited ? 0.45 : 0,
    blockers,
  };
}

export function buildInstitutionalIntelligence(
  benchmarkSnapshot: unknown,
  committeeSnapshot: unknown,
  now = Date.now(),
): InstitutionalIntelligenceReport {
  const references: InstitutionalReference[] = [
    { id: "cash-eur", label: "Efectivo EUR", category: "cash", verification: "internally-reproducible", copyTradingAllowed: false, comparisonWeight: 1, usableForDecisionContext: true, use: "Mide si operar compensa frente a no asumir riesgo." },
    { id: "buy-hold-per-asset", label: "Comprar y mantener cada activo", category: "buy-hold", verification: "internally-reproducible", copyTradingAllowed: false, comparisonWeight: 1, usableForDecisionContext: true, use: "Compara el motor con una alternativa pasiva usando las mismas fechas y costes." },
    { id: "equal-weight-selected", label: "Cartera equiponderada del universo elegible", category: "equal-weight", verification: "internally-reproducible", copyTradingAllowed: false, comparisonWeight: 1, usableForDecisionContext: true, use: "Comprueba si selección y timing añaden valor frente a diversificar sin predicción." },
    { id: "risk-parity-paper", label: "Cartera PAPER ponderada por riesgo", category: "risk-parity", verification: "internally-reproducible", copyTradingAllowed: false, comparisonWeight: 1, usableForDecisionContext: true, use: "Contrasta el tamaño adaptativo con una asignación sistemática por volatilidad y stop." },
    { id: "audited-professional-records", label: "Historiales profesionales auditados", category: "professional-disclosure", verification: "audited-public-record", copyTradingAllowed: false, comparisonWeight: 0.45, usableForDecisionContext: true, use: "Aporta contexto si existe historial completo, costes, posiciones abiertas y verificación independiente." },
    { id: "broker-research", label: "Informes de brokers y mesas profesionales", category: "broker-report", verification: "public-disclosure-only", copyTradingAllowed: false, comparisonWeight: 0.2, usableForDecisionContext: true, use: "Se usa como hipótesis macro o de posicionamiento, nunca como orden ni garantía." },
    { id: "public-wallets", label: "Carteras públicas y flujos on-chain", category: "public-wallet", verification: "public-disclosure-only", copyTradingAllowed: false, comparisonWeight: 0.25, usableForDecisionContext: true, use: "Permite estudiar acumulación, distribución y flujos, con advertencia sobre identidad, transferencias internas y cobertura fuera de cadena." },
    { id: "social-perfect-records", label: "Perfiles que publicitan 90-100 % de acierto", category: "professional-disclosure", verification: "unverified-claim", copyTradingAllowed: false, comparisonWeight: 0, usableForDecisionContext: false, use: "Se archiva para investigación, pero queda excluido hasta demostrar historial completo y auditable." },
  ];

  return {
    schemaVersion: "institutional-intelligence-v2",
    generatedAt: now,
    references,
    professionalClaimPolicy: {
      claimedPerfectWinRateIsEvidence: false,
      minimumClosedTrades: 30,
      fullHistoryRequired: true,
      timestampsRequired: true,
      costsRequired: true,
      openPositionsRequired: true,
      depositsAndWithdrawalsRequired: true,
      independentVerificationPreferred: true,
    },
    claimExamples: [
      assessClaim("100 % de acierto publicado en una red social"),
      assessClaim("Historial completo auditado con resultados netos", { fullHistory: true, audited: true, trades: 100, costs: true, openPositions: true, timestamps: true }),
    ],
    comparisonRules: [
      "Comparar siempre después de comisiones, spread, financiación y deslizamiento.",
      "Usar el mismo periodo, capital y universo para evitar comparaciones engañosas.",
      "Separar rentabilidad, drawdown, volatilidad, profit factor, expectativa y consistencia temporal.",
      "Registrar operaciones abiertas, depósitos, retiradas y cambios de capital.",
      "No aceptar porcentajes de acierto sin operaciones verificables y muestra completa.",
      "Penalizar sesgo de supervivencia, selección retrospectiva, borrado de pérdidas y resultados sin pérdidas publicados en redes.",
      "La coincidencia con un profesional solo aporta contexto; no autoriza ni veta una operación por sí sola.",
    ],
    safeguards: {
      noCopyTrading: true,
      noUnverifiedWinRates: true,
      noSignalAuthorityForThirdParties: true,
      survivorshipBiasWarning: true,
      netOfCostsRequired: true,
      liveTrading: false,
    },
    benchmarkSnapshot,
    committeeSnapshot,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
