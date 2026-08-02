export type DepartmentId =
  | "direccion-general"
  | "comite-decision"
  | "noticias-mundiales"
  | "interpretacion-graficas"
  | "macroeconomia"
  | "tesoreria"
  | "riesgo"
  | "comparativas"
  | "ia-predictiva"
  | "aprendizaje"
  | "auditoria"
  | "validacion-cientifica"
  | "deteccion-patrones"
  | "estadistica"
  | "ejecucion"
  | "significancia-economica";

export interface VirtualEmployee {
  id: string;
  department: "dirección" | "mercados" | "riesgo" | "noticias" | "gráficas" | "ejecución" | "evidencia" | "formación" | "comparativas";
  role: string;
  competencies: string[];
}

export interface DepartmentExcellenceStatus {
  id: DepartmentId;
  label: string;
  status: "operational" | "evidence-building" | "blocked";
  maturityPct: number;
  capabilities: string[];
  evidenceGate: string;
  mayTradeLive: false;
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

const DEPARTMENTS: DepartmentExcellenceStatus[] = [
  { id: "direccion-general", label: "Dirección General (CIO)", status: "operational", maturityPct: 88, capabilities: ["coordinación", "seguridad", "priorización por evidencia"], evidenceGate: "Mantener CI, despliegue y contabilidad coherentes durante la cohorte PAPER", mayTradeLive: false },
  { id: "comite-decision", label: "Comité de Decisión", status: "evidence-building", maturityPct: 82, capabilities: ["votos", "vetos", "explicación", "impacto shadow"], evidenceGate: "Demostrar mejora neta frente al baseline en forward test", mayTradeLive: false },
  { id: "noticias-mundiales", label: "Departamento Mundial de Noticias", status: "evidence-building", maturityPct: 80, capabilities: ["fuentes primarias", "impacto", "confianza", "activos", "duración"], evidenceGate: "Medir precisión e impacto incremental por activo", mayTradeLive: false },
  { id: "interpretacion-graficas", label: "Interpretación de Gráficas", status: "evidence-building", maturityPct: 84, capabilities: ["tendencia", "estructura", "volatilidad", "soportes", "resistencias", "regímenes"], evidenceGate: "Validar señales multitemporales fuera de muestra", mayTradeLive: false },
  { id: "macroeconomia", label: "Departamento Macroeconómico", status: "evidence-building", maturityPct: 72, capabilities: ["tipos", "inflación", "empleo", "PIB", "dólar", "bonos"], evidenceGate: "Persistir atribución macro por operación y horizonte", mayTradeLive: false },
  { id: "tesoreria", label: "Departamento de Tesorería", status: "operational", maturityPct: 86, capabilities: ["asignación", "capital disponible", "límites", "riesgo por carril"], evidenceGate: "Acreditar estabilidad de sizing en drawdown y costes adversos", mayTradeLive: false },
  { id: "riesgo", label: "Departamento de Riesgo", status: "operational", maturityPct: 90, capabilities: ["stops", "drawdown", "cooldown", "exposición", "bloqueos"], evidenceGate: "Superar stress de secuencia y pérdidas consecutivas", mayTradeLive: false },
  { id: "comparativas", label: "Comparativas Profesionales", status: "evidence-building", maturityPct: 78, capabilities: ["buy-and-hold", "benchmarks", "neto de costes", "sesgos"], evidenceGate: "Batir referencias comparables con muestra suficiente", mayTradeLive: false },
  { id: "ia-predictiva", label: "IA Predictiva", status: "evidence-building", maturityPct: 64, capabilities: ["probabilidades", "ranking", "contexto de mercado"], evidenceGate: "Calibración probabilística y validación temporal independiente", mayTradeLive: false },
  { id: "aprendizaje", label: "Departamento de Aprendizaje", status: "blocked", maturityPct: 58, capabilities: ["ledger de evidencia", "análisis post-trade", "formación continua"], evidenceGate: "No mutar parámetros hasta reunir cohorte suficiente y aprobación humana", mayTradeLive: false },
  { id: "auditoria", label: "Departamento de Auditoría", status: "operational", maturityPct: 89, capabilities: ["fuente única", "idempotencia", "cohortes", "explicabilidad"], evidenceGate: "Cero inconsistencias contables activas en producción", mayTradeLive: false },
  { id: "validacion-cientifica", label: "Validación Científica", status: "evidence-building", maturityPct: 76, capabilities: ["forward test", "stress", "muestra mínima", "separación in/out sample"], evidenceGate: "Completar duración y cierres mínimos sin cambiar la cohorte", mayTradeLive: false },
  { id: "deteccion-patrones", label: "Detección de Patrones", status: "evidence-building", maturityPct: 68, capabilities: ["cruces", "momentum", "regímenes", "secuencias"], evidenceGate: "Probar estabilidad por activo, carril y régimen", mayTradeLive: false },
  { id: "estadistica", label: "Departamento Estadístico", status: "evidence-building", maturityPct: 79, capabilities: ["win rate", "profit factor", "drawdown", "significancia económica"], evidenceGate: "Intervalos de confianza útiles y muestra no dominada por microganancias", mayTradeLive: false },
  { id: "ejecucion", label: "Departamento de Ejecución", status: "operational", maturityPct: 85, capabilities: ["spread", "slippage", "fees", "mínimos Kraken", "gates"], evidenceGate: "Registrar coste realizado frente al estimado en cada cierre", mayTradeLive: false },
  { id: "significancia-economica", label: "Significancia Económica", status: "operational", maturityPct: 87, capabilities: ["microganancias", "beneficio significativo", "PnL en EUR"], evidenceGate: "Acumular ganancias significativas netas en la cohorte corregida", mayTradeLive: false },
];

export function buildOrganizationalIntelligence(now = Date.now()) {
  const operational = DEPARTMENTS.filter((department) => department.status === "operational").length;
  const evidenceBuilding = DEPARTMENTS.filter((department) => department.status === "evidence-building").length;
  const blocked = DEPARTMENTS.filter((department) => department.status === "blocked").length;
  const averageMaturityPct = DEPARTMENTS.reduce((sum, department) => sum + department.maturityPct, 0) / DEPARTMENTS.length;

  return {
    schemaVersion: "auto-bolsa-organization-v2" as const,
    generatedAt: now,
    employeeCount: EMPLOYEES.length,
    employees: EMPLOYEES,
    departmentExcellence: {
      total: DEPARTMENTS.length,
      operational,
      evidenceBuilding,
      blocked,
      averageMaturityPct,
      allDepartmentsDeclared: true as const,
      excellenceClaimedWithoutEvidence: false as const,
      departments: DEPARTMENTS,
    },
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
    eligibleForLiveReview: false as const,
    liveTrading: false as const,
  };
}
