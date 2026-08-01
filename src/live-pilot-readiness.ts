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
 * Fases de journal alcanzables para cada estado de certificado, según el
 * orden estricto de `submitOrderWithAtomicPreflightCertificate`: el
 * certificado se consume justo antes de `persistIntent`, en la misma
 * operación atómica. Por tanto un certificado `valid` (aún no consumido)
 * nunca puede coexistir con una entrada de journal, y un certificado
 * `consumed` nunca puede coexistir con la ausencia de journal (`none`).
 * `absent`/`expired`/`invalid` tampoco se consumen nunca, así que solo
 * admiten `none`.
 */
const REACHABLE_JOURNAL_PHASES_BY_CERTIFICATE: Record<
  LivePilotReadinessCertificateStatus,
  ReadonlySet<LivePilotReadinessJournalPhase>
> = {
  absent: new Set(["none"]),
  expired: new Set(["none"]),
  invalid: new Set(["none"]),
  valid: new Set(["none"]),
  consumed: new Set(["intent_persisted", "transport_outcome_recorded", "reconciled"]),
};

/**
 * Verdadero si la combinación (certificado, journal) puede producirse
 * realmente en el flujo de `submitOrderWithAtomicPreflightCertificate`. Una
 * combinación inalcanzable (p. ej. `valid` + `reconciled`, o `consumed` +
 * `none`) señala una inconsistencia en el snapshot de entrada, nunca un
 * estado de negocio legítimo.
 */
export function isReachableCertificateJournalCombination(
  certificateStatus: LivePilotReadinessCertificateStatus,
  journalPhase: LivePilotReadinessJournalPhase,
): boolean {
  return REACHABLE_JOURNAL_PHASES_BY_CERTIFICATE[certificateStatus].has(journalPhase);
}

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
  guardrails: {
    /**
     * Valor actual de `LIVE_TRADING_ENABLED`. Puramente informativo: el
     * informe nunca exige que esté activo para declarar elegibilidad, porque
     * eso volvería circular una revisión previa a la propia activación. Se
     * espera que siga en `false` en todo momento anterior a un piloto real.
     */
    activationSwitchEnabled: boolean;
    /**
     * Resultado de `evaluateLiveGuardrails` calculado con el interruptor de
     * activación forzado a `true`, para aislar el resto de puertas
     * estructurales (una sola orden activa, una sola posición, tamaño
     * máximo, pérdida diaria, drawdown, frescura de mercado, errores de
     * transporte, etc.) del propio interruptor. `blockers` aquí nunca
     * contiene el bloqueo del interruptor.
     */
    structuralResult: LiveGuardrailResult;
  };
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
  /** Estado ya evaluado del certificado de preflight validate-only para la orden preparada actual. */
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
      activationSwitchEnabled: boolean;
      structuralAllowed: boolean;
      structuralBlockers: string[];
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
  /**
   * Elegible únicamente para una revisión manual humana de un futuro envío
   * inicial (certificado `valid` todavía sin consumir, journal en `none`).
   * Nunca activa, prepara ni envía nada.
   */
  eligibleForManualPilotReview: boolean;
  /**
   * Informativo, no gatea `eligibleForManualPilotReview`: verdadero cuando el
   * ciclo LIVE anterior (certificado consumido, journal reconciliado) quedó
   * verificado de forma consistente contra orden, fills y balances. Sirve
   * como evidencia acumulada, no como autorización para un nuevo envío: una
   * orden nueva siempre exige su propio certificado `valid` y journal `none`.
   */
  previousPilotCycleVerified: boolean;
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
  guardrails: LivePilotReadinessInputs["guardrails"],
  blockers: string[],
  warnings: string[],
  passedChecks: string[],
): void {
  if (guardrails.activationSwitchEnabled) {
    warnings.push(
      "Guardrails LIVE: LIVE_TRADING_ENABLED está activo; se esperaba que siguiera apagado antes de una revisión manual de piloto",
    );
  } else {
    passedChecks.push("Guardrails LIVE: el interruptor de activación permanece apagado, como corresponde antes de una revisión manual");
  }

  if (guardrails.structuralResult.allowed) {
    passedChecks.push("Guardrails LIVE: el resto de puertas estructurales (aparte del interruptor de activación) están superadas");
    return;
  }
  for (const blocker of guardrails.structuralResult.blockers) {
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

/**
 * Certificado y journal se evalúan juntos porque están acoplados por diseño
 * (ver `isReachableCertificateJournalCombination`). Devuelve si el ciclo
 * anterior (certificado consumido + journal reconciliado) quedó verificado,
 * sin que eso autorice ni sustituya el certificado `valid` que exige un
 * envío nuevo.
 */
function evaluatePreflightAndJournal(
  certificate: LivePilotReadinessInputs["preflightCertificate"],
  journal: LivePilotReadinessInputs["submissionJournal"],
  blockers: string[],
  passedChecks: string[],
): { previousCycleCertificateAndJournalVerified: boolean } {
  if (!isReachableCertificateJournalCombination(certificate.status, journal.phase)) {
    blockers.push(
      `Certificado/journal: combinación inalcanzable en el flujo real (certificado=${certificate.status}, journal=${journal.phase})`,
    );
    return { previousCycleCertificateAndJournalVerified: false };
  }

  if (certificate.status === "valid" && journal.phase === "none") {
    passedChecks.push("Certificado de preflight: vigente y aún sin consumir, listo para un envío inicial");
    passedChecks.push("Journal de envío: sin entrada previa para la orden preparada actual");
    return { previousCycleCertificateAndJournalVerified: false };
  }

  switch (certificate.status) {
    case "absent":
      blockers.push("Certificado de preflight: no existe ningún certificado emitido para la orden preparada");
      break;
    case "expired":
      blockers.push("Certificado de preflight: el certificado ha caducado");
      break;
    case "invalid":
      blockers.push("Certificado de preflight: el certificado no supera la verificación exacta");
      break;
    case "consumed":
      if (journal.phase === "intent_persisted") {
        blockers.push("Journal de envío: la intención se persistió pero no hay desenlace de transporte durable");
      } else if (journal.phase === "transport_outcome_recorded") {
        blockers.push("Journal de envío: existe un desenlace de transporte pendiente de reconciliación");
      } else {
        blockers.push(
          "Certificado de preflight: ya fue consumido en un ciclo anterior; un envío nuevo exige repetir el preflight y emitir un certificado propio",
        );
      }
      break;
  }

  const previousCycleCertificateAndJournalVerified = certificate.status === "consumed" && journal.phase === "reconciled";
  if (previousCycleCertificateAndJournalVerified) {
    passedChecks.push("Ciclo anterior: certificado consumido y journal reconciliado de forma verificable");
  }
  return { previousCycleCertificateAndJournalVerified };
}

function evaluateReconciliation(
  reconciliation: LivePilotReadinessInputs["reconciliation"],
  blockers: string[],
  passedChecks: string[],
): { reconciliationClean: boolean } {
  if (!reconciliation.everRun) {
    blockers.push("Reconciliación: nunca se ha ejecutado una reconciliación verificada");
    return { reconciliationClean: false };
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
  const reconciliationClean = reconciliation.ok
    && reconciliation.balanceStatus === "consistent"
    && reconciliation.unresolvedOrderCount === 0;
  if (reconciliationClean) {
    passedChecks.push("Reconciliación: orden, fills y balances confirmados de forma consistente");
  }
  return { reconciliationClean };
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
 * técnico —incluyendo un certificado `valid` sin consumir y un journal en
 * `none` para la orden preparada actual— y se cumplen íntegramente los
 * criterios de evidencia PAPER ya definidos en `paper-readiness.ts`.
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
  evaluateGuardrails(inputs.guardrails, blockers, warnings, passedChecks);
  evaluateKrakenPermissions(inputs.krakenPermissions, blockers, passedChecks);
  evaluatePairMetadata(inputs.pairMetadata, blockers, passedChecks);
  evaluatePreparedOrder(inputs.preparedOrder, blockers, passedChecks);
  const { previousCycleCertificateAndJournalVerified } = evaluatePreflightAndJournal(
    inputs.preflightCertificate,
    inputs.submissionJournal,
    blockers,
    passedChecks,
  );
  const { reconciliationClean } = evaluateReconciliation(inputs.reconciliation, blockers, passedChecks);
  evaluateEmergency(inputs.emergency, blockers, passedChecks);

  const eligibleForManualPilotReview = blockers.length === 0 && inputs.paper.eligibleForLiveReview;
  const previousPilotCycleVerified = previousCycleCertificateAndJournalVerified && reconciliationClean;

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
        activationSwitchEnabled: inputs.guardrails.activationSwitchEnabled,
        structuralAllowed: inputs.guardrails.structuralResult.allowed,
        structuralBlockers: inputs.guardrails.structuralResult.blockers,
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
    previousPilotCycleVerified,
    message: eligibleForManualPilotReview
      ? "Todas las comprobaciones técnicas y de evidencia PAPER están superadas. Elegible únicamente para revisión manual humana; este informe no activa ni autoriza ningún envío."
      : `No elegible para revisión manual: ${blockers.length} bloqueo(s) pendiente(s).`,
  };
}
