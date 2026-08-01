export interface InstitutionalReference {
  id: string;
  label: string;
  category: "cash" | "buy-hold" | "equal-weight" | "risk-parity" | "professional-disclosure";
  verification: "internally-reproducible" | "public-disclosure-only";
  copyTradingAllowed: false;
  use: string;
}

export interface InstitutionalIntelligenceReport {
  schemaVersion: "institutional-intelligence-v1";
  generatedAt: number;
  references: InstitutionalReference[];
  comparisonRules: string[];
  safeguards: {
    noCopyTrading: true;
    noUnverifiedWinRates: true;
    survivorshipBiasWarning: true;
    netOfCostsRequired: true;
    liveTrading: false;
  };
  benchmarkSnapshot: unknown;
  committeeSnapshot: unknown;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export function buildInstitutionalIntelligence(
  benchmarkSnapshot: unknown,
  committeeSnapshot: unknown,
  now = Date.now(),
): InstitutionalIntelligenceReport {
  const references: InstitutionalReference[] = [
    {
      id: "cash-eur",
      label: "Efectivo EUR",
      category: "cash",
      verification: "internally-reproducible",
      copyTradingAllowed: false,
      use: "Mide si operar compensa frente a no asumir riesgo.",
    },
    {
      id: "buy-hold-per-asset",
      label: "Comprar y mantener cada activo",
      category: "buy-hold",
      verification: "internally-reproducible",
      copyTradingAllowed: false,
      use: "Compara el motor con una alternativa pasiva usando las mismas fechas y costes.",
    },
    {
      id: "equal-weight-selected",
      label: "Cartera equiponderada del universo elegible",
      category: "equal-weight",
      verification: "internally-reproducible",
      copyTradingAllowed: false,
      use: "Comprueba si la selección y el timing añaden valor frente a diversificar sin predicción.",
    },
    {
      id: "risk-parity-paper",
      label: "Cartera PAPER ponderada por riesgo",
      category: "risk-parity",
      verification: "internally-reproducible",
      copyTradingAllowed: false,
      use: "Contrasta el tamaño adaptativo con una asignación sistemática por volatilidad y stop.",
    },
    {
      id: "public-professional-disclosures",
      label: "Carteras y divulgaciones profesionales públicas",
      category: "professional-disclosure",
      verification: "public-disclosure-only",
      copyTradingAllowed: false,
      use: "Aporta contexto retrasado; nunca se interpreta como señal inmediata ni como tasa de acierto garantizada.",
    },
  ];
  return {
    schemaVersion: "institutional-intelligence-v1",
    generatedAt: now,
    references,
    comparisonRules: [
      "Comparar siempre después de comisiones, spread y deslizamiento.",
      "Usar el mismo periodo, capital y universo para evitar comparaciones engañosas.",
      "Separar rentabilidad, drawdown, volatilidad, profit factor y consistencia temporal.",
      "No aceptar porcentajes de acierto de terceros sin operaciones verificables y muestra completa.",
      "Penalizar sesgo de supervivencia, selección retrospectiva y resultados sin pérdidas publicados en redes.",
    ],
    safeguards: {
      noCopyTrading: true,
      noUnverifiedWinRates: true,
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
