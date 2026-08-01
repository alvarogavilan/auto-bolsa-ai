import { describe, expect, it } from "vitest";
import {
  calculateLivePilotReadiness,
  LIVE_PILOT_READINESS_SCHEMA_VERSION,
  type LivePilotReadinessInputs,
} from "../src/live-pilot-readiness";
import type { PaperReadiness } from "../src/paper-readiness";

function fullyPassingPaper(): PaperReadiness {
  return {
    phase: "paper-validation",
    evidenceMethod: "closed-15m-candles-v1",
    evidenceStartedAt: 0,
    daysObserved: 20,
    tickAttempts: 2000,
    uniqueClosedCandlesObserved: 600,
    duplicateCandleSkips: 0,
    errorsObserved: 0,
    errorRatePct: 0,
    closedTrades: 40,
    winningTrades: 25,
    losingTrades: 15,
    winRatePct: 62.5,
    netPnlEur: 12.5,
    returnPct: 25,
    totalFeesEur: 1.2,
    profitFactor: 1.8,
    currentDrawdownPct: 1,
    maxObservedDrawdownPct: 2,
    requirements: {
      minimumDays: 14,
      minimumUniqueClosedCandles: 500,
      minimumClosedTrades: 30,
      positiveNetPnl: true,
      minimumProfitFactor: 1.1,
      maximumDrawdownPct: 5,
      maximumErrorRatePct: 1,
    },
    checks: {
      enoughDays: true,
      enoughUniqueClosedCandles: true,
      enoughClosedTrades: true,
      positiveNetPnl: true,
      profitFactorAccepted: true,
      drawdownAccepted: true,
      errorRateAccepted: true,
    },
    eligibleForLiveReview: true,
    liveTrading: false,
    message: "La evidencia PAPER de velas cerradas cumple los mínimos para una revisión humana. El trading real sigue bloqueado.",
  };
}

function insufficientPaper(): PaperReadiness {
  const paper = fullyPassingPaper();
  return {
    ...paper,
    closedTrades: 3,
    checks: { ...paper.checks, enoughClosedTrades: false },
    eligibleForLiveReview: false,
    message: "La evidencia PAPER todavía no cumple todos los mínimos. No se permite usar dinero real.",
  };
}

function fullyReadyInputs(): LivePilotReadinessInputs {
  return {
    paper: fullyPassingPaper(),
    demo: { status: "observing_market" },
    guardrails: { allowed: true, blockers: [] },
    krakenPermissions: { auditComplete: true, safePermissions: true },
    pairMetadata: { resolved: true, stale: false },
    preparedOrder: { exists: true },
    preflightCertificate: { status: "valid" },
    submissionJournal: { phase: "reconciled" },
    reconciliation: {
      everRun: true,
      ok: true,
      balanceStatus: "consistent",
      unresolvedOrderCount: 0,
    },
    emergency: { active: false, manualLiquidationPending: false },
  };
}

function initialStateInputs(): LivePilotReadinessInputs {
  return {
    paper: insufficientPaper(),
    demo: { status: "initializing" },
    guardrails: { allowed: false, blockers: ["LIVE_TRADING_ENABLED no está activado"] },
    krakenPermissions: { auditComplete: false, safePermissions: false },
    pairMetadata: { resolved: false, stale: false },
    preparedOrder: { exists: false },
    preflightCertificate: { status: "absent" },
    submissionJournal: { phase: "none" },
    reconciliation: {
      everRun: false,
      ok: false,
      balanceStatus: "never_checked",
      unresolvedOrderCount: 0,
    },
    emergency: { active: false, manualLiquidationPending: false },
  };
}

describe("live pilot readiness (read-only report)", () => {
  it("blocks everything with the initial state", () => {
    const report = calculateLivePilotReadiness(initialStateInputs(), 1_000);
    expect(report.schemaVersion).toBe(LIVE_PILOT_READINESS_SCHEMA_VERSION);
    expect(report.liveTrading).toBe(false);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.some((blocker) => blocker.includes("PAPER"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Permisos Kraken"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Metadatos de par"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Orden preparada"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Certificado de preflight"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Journal de envío"))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.includes("Reconciliación"))).toBe(true);
  });

  it("is not eligible when PAPER evidence is missing even if the rest of the infrastructure is complete", () => {
    const inputs: LivePilotReadinessInputs = { ...fullyReadyInputs(), paper: insufficientPaper() };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers.some((blocker) => blocker.includes("PAPER"))).toBe(true);
  });

  it("is not eligible with an absent preflight certificate", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      preflightCertificate: { status: "absent" },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Certificado de preflight: no existe ningún certificado emitido");
  });

  it("is not eligible with an expired preflight certificate", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      preflightCertificate: { status: "expired" },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Certificado de preflight: el certificado ha caducado");
  });

  it("is not eligible with a consumed preflight certificate", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      preflightCertificate: { status: "consumed" },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Certificado de preflight: el certificado ya fue consumido");
  });

  it("is not eligible with an invalid preflight certificate", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      preflightCertificate: { status: "invalid" },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Certificado de preflight: el certificado no supera la verificación exacta");
  });

  it("is not eligible when reconciliation has never run", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      reconciliation: {
        everRun: false,
        ok: false,
        balanceStatus: "never_checked",
        unresolvedOrderCount: 0,
      },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Reconciliación: nunca se ha ejecutado una reconciliación verificada");
  });

  it("is not eligible when the balance status is unknown", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      reconciliation: {
        everRun: true,
        ok: true,
        balanceStatus: "unknown",
        unresolvedOrderCount: 0,
      },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers.some((blocker) => blocker.includes("balance no está confirmado"))).toBe(true);
  });

  it("is not eligible when the balance status is inconsistent", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      reconciliation: {
        everRun: true,
        ok: false,
        balanceStatus: "inconsistent",
        unresolvedOrderCount: 0,
      },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers.some((blocker) => blocker.includes("inconsistent"))).toBe(true);
  });

  it("is not eligible with unresolved orders after reconciliation", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      reconciliation: {
        everRun: true,
        ok: true,
        balanceStatus: "consistent",
        unresolvedOrderCount: 2,
      },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Reconciliación: quedan 2 orden(es) sin resolver");
  });

  it("is not eligible with an active emergency stop", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      emergency: { active: true, manualLiquidationPending: false },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Emergencia: la parada de emergencia sigue activa");
  });

  it("is not eligible with pending manual liquidation", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      emergency: { active: false, manualLiquidationPending: true },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Emergencia: queda liquidación manual pendiente tras una parada previa");
  });

  it("is not eligible when guardrails report any blocker", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      guardrails: { allowed: false, blockers: ["Límite de drawdown alcanzado"] },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Guardrails LIVE: Límite de drawdown alcanzado");
  });

  it("is not eligible with stale pair metadata", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      pairMetadata: { resolved: true, stale: true },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("Metadatos de par: la resolución del par está obsoleta y requiere refresco");
  });

  it("is not eligible when the submission journal is not reconciled", () => {
    const pendingPhases: LivePilotReadinessInputs["submissionJournal"]["phase"][] = [
      "intent_persisted",
      "transport_outcome_recorded",
    ];
    for (const phase of pendingPhases) {
      const inputs: LivePilotReadinessInputs = {
        ...fullyReadyInputs(),
        submissionJournal: { phase },
      };
      const report = calculateLivePilotReadiness(inputs, 1_000);
      expect(report.eligibleForManualPilotReview).toBe(false);
    }
  });

  it("is not eligible when the shadow-live DEMO strategy is in error", () => {
    const inputs: LivePilotReadinessInputs = {
      ...fullyReadyInputs(),
      demo: { status: "error" },
    };
    const report = calculateLivePilotReadiness(inputs, 1_000);
    expect(report.eligibleForManualPilotReview).toBe(false);
    expect(report.blockers).toContain("DEMO: la estrategia shadow-live está aislada por errores consecutivos");
  });

  it("is eligible only for manual review, never for execution, when every input is valid", () => {
    const report = calculateLivePilotReadiness(fullyReadyInputs(), 1_000);
    expect(report.eligibleForManualPilotReview).toBe(true);
    expect(report.liveTrading).toBe(false);
    expect(report.blockers).toEqual([]);
    expect(report.passedChecks.length).toBeGreaterThan(0);
    expect(report.message).not.toMatch(/ejecut/i);
    expect(report.message).toMatch(/revisión manual/i);
  });

  it("never contains secrets or sensitive fields", () => {
    const report = calculateLivePilotReadiness(fullyReadyInputs(), 1_000);
    const serialized = JSON.stringify(report).toLowerCase();
    const forbiddenFragments = [
      "apikey",
      "api_key",
      "apisecret",
      "api_secret",
      "secret",
      "password",
      "privatekey",
      "signature",
    ];
    for (const fragment of forbiddenFragments) {
      expect(serialized).not.toContain(fragment);
    }
    // Solo los dos booleanos de auditoría de permisos, nunca la lista completa.
    expect(report.sections.krakenPermissions).toEqual({ auditComplete: true, safePermissions: true });
  });

  it("is a pure function: identical inputs and clock always produce an identical report", () => {
    const inputs = fullyReadyInputs();
    const first = calculateLivePilotReadiness(inputs, 1_000);
    const second = calculateLivePilotReadiness(inputs, 1_000);
    expect(first).toEqual(second);
  });
});
