export interface VirtualEmployee {
  id: string;
  department: "dirección" | "mercados" | "riesgo" | "noticias" | "gráficas" | "ejecución" | "evidencia" | "formación" | "comparativas";
  role: string;
  competencies: string[];
}

const EMPLOYEES: VirtualEmployee[] = [
  { id: "cto", department: "dirección", role: "CTO y coordinador del comité", competencies: ["arquitectura", "seguridad", "validación"] },
  { id: "market-1", department: "mercados", role: "Analista de universo Kraken", competencies: ["liquidez", "spread", "volatilidad", "microestructura"] },
  { id: "risk-1", department: "riesgo", role: "Responsable de riesgo", competencies: ["position sizing", "drawdown", "stops", "exposición"] },
  { id: "news-1", department: "noticias", role: "Analista macro y geopolítico", competencies: ["bancos centrales", "guerras", "sanciones", "energía"] },
  { id: "news-2", department: "noticias", role: "Analista regulatorio y cripto", competencies: ["regulación", "ETF", "exchanges", "ciberseguridad"] },
  { id: "chart-1", department: "gráficas", role: "Analista técnico multitemporal", competencies: ["tendencia", "momentum", "RSI", "ATR", "soportes", "resistencias"] },
  { id: "execution-1", department: "ejecución", role: "Especialista de ejecución PAPER", competencies: ["slippage", "fees", "mínimos", "calidad de fill"] },
  { id: "evidence-1", department: "evidencia", role: "Auditor de operaciones", competencies: ["ledger", "PnL", "explicabilidad", "reproducibilidad"] },
  { id: "training-1", department: "formación", role: "Director de formación continua", competencies: ["currículo", "evaluación", "actualización profesional"] },
  { id: "comparison-1", department: "comparativas", role: "Analista de benchmarks y profesionales", competencies: ["benchmarks", "sesgos", "track records", "neto de costes"] },
];

export function buildOrganizationalIntelligence(now = Date.now()) {
  return {
    schemaVersion: "auto-bolsa-organization-v1" as const,
    generatedAt: now,
    employeeCount: EMPLOYEES.length,
    employees: EMPLOYEES,
    trainingPolicy: {
      continuousTraining: true as const,
      evidenceRequired: true as const,
      noAutonomousLiveAuthority: true as const,
      curriculum: [
        "Kraken Pro, mercados spot y microestructura",
        "Análisis técnico multitemporal y lectura de velas",
        "Macroeconomía, geopolítica y transmisión de noticias a activos",
        "Gestión monetaria, riesgo, drawdown y tamaño de posición",
        "Comisiones, spread, deslizamiento y ejecución",
        "Backtesting, forward testing, sesgos y validación estadística",
        "Auditoría, explicabilidad y aprendizaje controlado",
      ],
    },
    liveTrading: false as const,
  };
}
