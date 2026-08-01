import type { LiveGuardrailResult } from "./live-guardrails";
import type { PaperReadiness } from "./paper-readiness";
import type { ShadowLiveDemoStatus } from "./shadow-live-demo";

// Módulo de solo lectura: calcula un informe versionado a partir de entradas
// explícitas ya evaluadas por otros módulos puros (guardrails, PAPER, DEMO,
// certificado, journal, reconciliación). No lee secretos, no realiza llamadas
// de red y no importa nada de los ficheros LIVE que activan envíos reales.
// Este fichero nunca debe ganar un binding, ruta, cron o botón: solo produce
// un informe para revisión humana manual.

export const LIVE_PILOT_READINESS_SCHEMA_VERSION = "live-pilot-readiness-v1";

export type LivePilotReadinessCertificateStatus =
  | "absent"
  | "valid"
  | "expired"
  | "consumed"
  | "invalid";

export type LivePilotReadinessJournalPhase =
  | "none"
  | "intent_persisted"
  | "transport_outcome_recorded"
  | "reconciled";

export type LivePilotReadinessBalanceStatus =
  | "consistent"
  | "inconsistent"
  | "unknown"
  | "never_checked";

/**
 * Entradas explícitas del informe. Cada sección corresponde a la salida ya
 * calculada de un módulo puro existente (o a un resumen deliberadamente
 * reducido de esa salida, para no filtrar campos sensibles). Ningún campo
 * aquí se lee de secretos, red o almacenamiento: quien construya este objeto
 * es responsable de haber obtenido cada valor de forma segura.
 */
export interface LivePilotReadinessInputs {
  /** Salida sin modificar de `calculatePaperReadiness`. */
  paper: PaperReadiness;
  /** Estado resumido del DEMO shadow-live; solo el estado, sin cifras de estrategia. */
  demo: {
    status: ShadowLiveDemoStatus;
  };
  /** Salida sin modificar de `evaluateLiveGuardrails` para la orden preparada actual. */
  guardrails: LiveGuardrailResult;
  /**
   * Únicamente los dos booleanos de auditoría de permisos Kraken. Nunca la
   * lista completa de permisos, el nombre de la API key ni su expiración.
   */
  krakenPermissions: {
    auditComplete: boolean;
    safePermissions: boolean;
  };
  /** Disponibilidad de metadatos reales del par (AssetPairs) y su frescura. */
  pairMetadata: {
    resolved: boolean;
    stale: boolean;
  };
  /** Existencia de una orden preparada (estado "prepared" en el ejecutor). */
  preparedOrder: {
    exists: boolean;
  };
  /** Estado ya evaluado del certificado de preflight validate-only. */
  preflightCertificate: {
    status: LivePilotReadinessCertificateStatus;
  };
  /** Fase del journal write-ahead de envío para la orden preparada actual. */
  submissionJournal: {
    phase: LivePilotReadinessJournalPhase;
  };
  /** Estado ya evaluado de la reconciliación verificada de orden, fills y balances. */
  reconciliation: {
    everRun: boolean;
    ok: boolean;
    balanceStatus: LivePilotReadinessBalanceStatus;
    unresolvedOrderCount: number;
  };
  /** Estado de parada de emergencia y liquidación manual pendiente. */
  emergency: {
    active: boolean;
    manualLiquidationPending: boolean;
  };
}

export interface LivePilotReadinessReport {
  schemaVersion: "live-pilot-readiness-v1";
  generatedAt: number;
  /** Este informe nunca activa trading; es documentación de solo lectura. */
  liveTrading: false;
  sections: {
    paper: {
      eligibleForLiveReview: boolean;
      checks: PaperReadiness["checks"];
    };
    demo: {
      status: ShadowLiveDemoStatus;
    };
    guardrails: {
      allowed: boolean;
      blockers: string[];
    };
    krakenPermissions: {
      auditComplete: boolean;
      safePermissions: boolean;
    };
    pairMetadata: {
      resolved: boolean;
      stale: boolean;
    };
    preparedOrder: {
      exists: boolean;
    };
    preflightCertificate: {
      status: LivePilotReadinessCertificateStatus;
    };
    submissionJournal: {
      phase: LivePilotReadinessJournalPhase;
    };
    reconciliation: {
      everRun: boolean;
      ok: boolean;
      balanceStatus: LivePilotReadinessBalanceStatus;
      unresolvedOrderCount: number;
    };
    emergency: {
      active: boolean;
      manualLiquidationPending: boolean;
    };
  };
  blockers: string[];
  warnings: string[];
  passedChecks: string[];
  eligibleForManualPilotReview: boolean;
  message: string;
}

const PAPER_CHECK_LABELS: Record<keyof PaperReadiness["checks"], string> = {
  enoughDays: "Faltan días suficientes de operación PAPER",
  enoughUniqueClosedCandles: "Faltan velas cerradas únicas suficientes en PAPER",
  enoughClosedTrades: "Faltan operaciones cerradas suficientes en PAPER",
  positiveNetPnl: "El PnL neto acumulado en PAPER no es positivo",
  profitFactorAccepted: "El profit factor de PAPER no alcanza el mínimo exigido",
  drawdownAccepted: "El drawdown máximo de PAPER supera el máximo permitido",
  errorRateAccepted: "La tasa de errores de PAPER supera el máximo permitido",
};

function evaluatePaper(paper: PaperReadiness, blockers: string[], passedChecks: string[]): void {
  for (const [key, label] of Object.entries(PAPER_CHECK_LABELS) as [keyof PaperReadiness["checks"], string][]) {
    if (paper.checks[key]) {
      passedChecks.push(`PAPER: ${key} superado`);
    } else {
      blockers.push(`PAPER: ${label}`);
    }
  }
}

function evaluateDemo(
  demo: LivePilotReadinessInputs["demo"],
  blockers: string[],
  warnings: string[],
  passedChecks: string[],
): void {
  if (demo.status === "error") {
    blockers.push("DEMO: la estrategia shadow-live está aislada por errores consecutivos");
    return;
  }
  if (demo.status === "safety_halt") {
    warnings.push("DEMO: la estrategia shadow-live está detenida por un límite de seguridad");
    return;
  }
  if (demo.status === "initializing") {
    warnings.push("DEMO: la estrategia shadow-live todavía no se ha inicializado");
    return;
  }
  passedChecks.push(`DEMO: estado ${demo.status} sin anomalías`);
}

function evaluateGuardrails(
  guardrails: LiveGuardrailResult,
  blockers: string[],
  passedChecks: string[],
): void {
  if (guardrails.allowed) {
    passedChecks.push("Guardrails LIVE: todas las puertas estructurales superadas");
    return;
  }
  for (const blocker of guardrails.blockers) {
    blockers.push(`Guardrails LIVE: ${blocker}`);
  }
}

function evaluateKrakenPermissions(
  permissions: LivePilotReadinessInputs["krakenPermissions"],
  blockers: string[],
  passedChecks: string[],
): void {
  if (!permissions.auditComplete) {
    blockers.push("Permisos Kraken: la auditoría de permisos no se ha completado");
    return;
  }
  if (!permissions.safePermissions) {
    blockers.push("Permisos Kraken: la API key tiene permisos que no son seguros para LIVE");
    return;
  }
  passedChecks.push("Permisos Kraken: auditoría completa y permisos seguros");
}

function evaluatePairMetadata(
  pairMetadata: LivePilotReadinessInputs["pairMetadata"],
  blockers: string[],
  passedChecks: string[],
): void {
  if (!pairMetadata.resolved) {
    blockers.push("Metadatos de par: el par no se ha resuelto contra AssetPairs de Kraken");
    return;
  }
  if (pairMetadata.stale) {
    blockers.push("Metadatos de par: la resolución del par está obsoleta y requiere refresco");
    return;
  }
  passedChecks.push("Metadatos de par: resueltos y frescos");
}

function evaluatePreparedOrder(
  preparedOrder: LivePilotReadinessInputs["preparedOrder"],
  blockers: string[],
  passedChecks: string[],
): void {
  if (!preparedOrder.exists) {
    blockers.push("Orden preparada: no existe ninguna orden preparada para revisar el flujo completo");
    return;
  }
  passedChecks.push("Orden preparada: existe una orden preparada");
}

function evaluatePreflightCertificate(
  certificate: LivePilotReadinessInputs["preflightCertificate"],
  blockers: string[],
  passedChecks: string[],
): void {
  switch (certificate.status) {
    case "valid":
      passedChecks.push("Certificado de preflight: vigente y validado por Kraken");
      return;
    case "absent":
      blockers.push("Certificado de preflight: no existe ningún certificado emitido");
      return;
    case "expired":
      blockers.push("Certificado de preflight: el certificado ha caducado");
      return;
    case "consumed":
      blockers.push("Certificado de preflight: el certificado ya fue consumido");
      return;
    case "invalid":
      blockers.push("Certificado de preflight: el certificado no supera la verificación exacta");
      return;
  }
}

function evaluateSubmissionJournal(
  journal: LivePilotReadinessInputs["submissionJournal"],
  blockers: string[],
  passedChecks: string[],
): void {
  switch (journal.phase) {
    case "reconciled":
      passedChecks.push("Journal de envío: la última entrada está reconciliada");
      return;
    case "none":
      blockers.push("Journal de envío: no existe ninguna entrada de journal para la orden preparada");
      return;
    case "intent_persisted":
      blockers.push("Journal de envío: la intención se persistió pero no hay desenlace de transporte durable");
      return;
    case "transport_outcome_recorded":
      blockers.push("Journal de envío: existe un desenlace de transporte pendiente de reconciliación");
      return;
  }
}

function evaluateReconciliation(
  reconciliation: LivePilotReadinessInputs["reconciliation"],
  blockers: string[],
  passedChecks: string[],
): void {
  if (!reconciliation.everRun) {
    blockers.push("Reconciliación: nunca se ha ejecutado una reconciliación verificada");
    return;
  }
  if (!reconciliation.ok) {
    blockers.push("Reconciliación: la última reconciliación verificada no terminó en ok");
  }
  if (reconciliation.balanceStatus !== "consistent") {
    blockers.push(`Reconciliación: el balance no está confirmado como consistente (estado=${reconciliation.balanceStatus})`);
  }
  if (reconciliation.unresolvedOrderCount > 0) {
    blockers.push(`Reconciliación: quedan ${reconciliation.unresolvedOrderCount} orden(es) sin resolver`);
  }
  if (reconciliation.ok && reconciliation.balanceStatus === "consistent" && reconciliation.unresolvedOrderCount === 0) {
    passedChecks.push("Reconciliación: orden, fills y balances confirmados de forma consistente");
  }
}

function evaluateEmergency(
  emergency: LivePilotReadinessInputs["emergency"],
  blockers: string[],
  passedChecks: string[],
): void {
  if (emergency.active) {
    blockers.push("Emergencia: la parada de emergencia sigue activa");
  }
  if (emergency.manualLiquidationPending) {
    blockers.push("Emergencia: queda liquidación manual pendiente tras una parada previa");
  }
  if (!emergency.active && !emergency.manualLiquidationPending) {
    passedChecks.push("Emergencia: sin parada activa ni liquidación manual pendiente");
  }
}

/**
 * Función pura: calcula el informe de preparación para un futuro piloto LIVE
 * a partir de entradas explícitas. No lee secretos, no realiza llamadas de
 * red ni de almacenamiento, y `eligibleForManualPilotReview` nunca activa
 * trading por sí mismo; solo puede ser `true` cuando no queda ningún blocker
 * y se cumplen íntegramente los criterios de evidencia PAPER ya definidos en
 * `paper-readiness.ts`.
 */
export function calculateLivePilotReadiness(
  inputs: LivePilotReadinessInputs,
  now = Date.now(),
): LivePilotReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const passedChecks: string[] = [];

  evaluatePaper(inputs.paper, blockers, passedChecks);
  evaluateDemo(inputs.demo, blockers, warnings, passedChecks);
  evaluateGuardrails(inputs.guardrails, blockers, passedChecks);
  evaluateKrakenPermissions(inputs.krakenPermissions, blockers, passedChecks);
  evaluatePairMetadata(inputs.pairMetadata, blockers, passedChecks);
  evaluatePreparedOrder(inputs.preparedOrder, blockers, passedChecks);
  evaluatePreflightCertificate(inputs.preflightCertificate, blockers, passedChecks);
  evaluateSubmissionJournal(inputs.submissionJournal, blockers, passedChecks);
  evaluateReconciliation(inputs.reconciliation, blockers, passedChecks);
  evaluateEmergency(inputs.emergency, blockers, passedChecks);

  const eligibleForManualPilotReview = blockers.length === 0 && inputs.paper.eligibleForLiveReview;

  return {
    schemaVersion: LIVE_PILOT_READINESS_SCHEMA_VERSION,
    generatedAt: now,
    liveTrading: false,
    sections: {
      paper: {
        eligibleForLiveReview: inputs.paper.eligibleForLiveReview,
        checks: inputs.paper.checks,
      },
      demo: {
        status: inputs.demo.status,
      },
      guardrails: {
        allowed: inputs.guardrails.allowed,
        blockers: inputs.guardrails.blockers,
      },
      krakenPermissions: inputs.krakenPermissions,
      pairMetadata: inputs.pairMetadata,
      preparedOrder: inputs.preparedOrder,
      preflightCertificate: inputs.preflightCertificate,
      submissionJournal: inputs.submissionJournal,
      reconciliation: inputs.reconciliation,
      emergency: inputs.emergency,
    },
    blockers,
    warnings,
    passedChecks,
    eligibleForManualPilotReview,
    message: eligibleForManualPilotReview
      ? "Todas las comprobaciones técnicas y de evidencia PAPER están superadas. Elegible únicamente para revisión manual humana; este informe no activa ni autoriza ningún envío."
      : `No elegible para revisión manual: ${blockers.length} bloqueo(s) pendiente(s).`,
  };
}
