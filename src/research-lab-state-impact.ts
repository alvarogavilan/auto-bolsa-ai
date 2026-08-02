import {
  applyCommitteeTradeSnapshot,
  buildCommitteeShadowImpactReport,
  emptyCommitteeShadowImpactState,
  sanitizeCommitteeShadowImpactState,
  type CommitteeShadowImpactState,
} from "./committee-shadow-impact";
import { buildCostSequenceStressReport } from "./cost-sequence-stress";
import type { ResearchCommitteeReport } from "./decision-committee";
import { buildInstitutionalIntelligence } from "./institutional-intelligence";
import { buildMarketProductIntelligence } from "./market-product-intelligence";
import { buildNewsIntelligence, type NewsIntelligenceReport } from "./news-intelligence";
import {
  applyPaperEvidenceSnapshot,
  buildPaperEvidenceLedgerReport,
  emptyPaperEvidenceLedgerState,
  hydrateStrategiesWithEvidence,
  sanitizePaperEvidenceLedgerState,
  type PaperEvidenceLedgerState,
} from "./paper-evidence-ledger";
import type { ResearchLabState as StoredResearchLabState } from "./research-lab";
import { ResearchLabState as BaseResearchLabState } from "./research-lab-state-base";
import { buildTemporalValidationReport } from "./temporal-validation";
import type { Env } from "./types";

const COMMITTEE_IMPACT_KEY = "committee-shadow-impact-v1";
const PAPER_EVIDENCE_KEY = "paper-trade-evidence-v1";

interface LabResponsePayload {
  initialized?: boolean;
  state?: StoredResearchLabState;
  committee?: ResearchCommitteeReport;
  benchmarkSuite?: unknown;
  benchmarkComparison?: unknown;
  [key: string]: unknown;
}

interface SafeImpactRead { impact: CommitteeShadowImpactState; error: string | null; }
interface SafeEvidenceRead { ledger: PaperEvidenceLedgerState; error: string | null; }

function validCommittee(value: unknown): value is ResearchCommitteeReport {
  return Boolean(value && typeof value === "object" && (value as ResearchCommitteeReport).schemaVersion === "paper-research-committee-v1" && Array.isArray((value as ResearchCommitteeReport).reports));
}

function unavailableNews(now: number, error: unknown): NewsIntelligenceReport {
  return {
    schemaVersion: "global-news-intelligence-v2",
    generatedAt: now,
    refreshTargetSeconds: 60,
    sourcesConfigured: 10,
    sourcesAvailable: 0,
    signals: [],
    breakingSignals: 0,
    highImpactSignals: 0,
    coverage: {
      regions: ["US", "EU", "UK", "GLOBAL"],
      topics: ["monetary-policy", "inflation", "geopolitics", "war", "sanctions", "political-speech", "regulation", "cybersecurity", "exchange-incident", "energy", "shipping", "etf", "other"],
      primarySourcesOnly: true,
      impossibleToGuaranteeTotalWorldCoverage: true,
    },
    sourceStatus: [{ id: "department", label: "Departamento mundial de noticias", available: false, items: 0, latencyMs: 0, error: error instanceof Error ? error.message : "NEWS_INTELLIGENCE_FAILED" }],
    changesTradingDecision: false,
    advisoryOnly: true,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}

export class ResearchLabState extends BaseResearchLabState {
  private readonly auxiliaryStorage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.auxiliaryStorage = ctx.storage;
  }

  private async readImpact(now = Date.now()): Promise<SafeImpactRead> {
    try {
      return { impact: sanitizeCommitteeShadowImpactState(await this.auxiliaryStorage.get<unknown>(COMMITTEE_IMPACT_KEY), now), error: null };
    } catch {
      return { impact: emptyCommitteeShadowImpactState(now), error: "COMMITTEE_IMPACT_STORAGE_READ_FAILED" };
    }
  }

  private async readEvidence(now = Date.now()): Promise<SafeEvidenceRead> {
    try {
      return { ledger: sanitizePaperEvidenceLedgerState(await this.auxiliaryStorage.get<unknown>(PAPER_EVIDENCE_KEY), now), error: null };
    } catch {
      return { ledger: emptyPaperEvidenceLedgerState(now), error: "PAPER_EVIDENCE_STORAGE_READ_FAILED" };
    }
  }

  private async enrichLabResponse(response: Response, shouldPersistSnapshot: boolean, now = Date.now()): Promise<Response> {
    let payload: LabResponsePayload;
    try {
      const value = await response.clone().json();
      if (!value || typeof value !== "object" || Array.isArray(value)) return response;
      payload = value as LabResponsePayload;
    } catch {
      return response;
    }

    const currentStrategies = payload.state && Array.isArray(payload.state.strategies) ? payload.state.strategies : [];
    const [safeImpact, safeEvidence, newsIntelligence] = await Promise.all([
      this.readImpact(now),
      this.readEvidence(now),
      buildNewsIntelligence(now).catch((error) => unavailableNews(now, error)),
    ]);

    let impact = safeImpact.impact;
    let impactError = safeImpact.error;
    const evidence = applyPaperEvidenceSnapshot(safeEvidence.ledger, currentStrategies, now);
    let evidenceError = safeEvidence.error;

    if (shouldPersistSnapshot && payload.initialized === true && currentStrategies.length > 0) {
      try {
        impact = applyCommitteeTradeSnapshot(impact, currentStrategies, validCommittee(payload.committee) ? payload.committee : null, now);
        await this.auxiliaryStorage.put(COMMITTEE_IMPACT_KEY, impact);
      } catch {
        impactError = "COMMITTEE_IMPACT_PERSIST_FAILED";
      }
      try {
        await this.auxiliaryStorage.put(PAPER_EVIDENCE_KEY, evidence);
      } catch {
        evidenceError = "PAPER_EVIDENCE_PERSIST_FAILED";
      }
    }

    const evidenceStrategies = hydrateStrategiesWithEvidence(currentStrategies, evidence);
    const temporalValidation = buildTemporalValidationReport(evidenceStrategies);
    const costSequenceStress = buildCostSequenceStressReport(evidenceStrategies);
    const marketProductIntelligence = buildMarketProductIntelligence(now);
    const institutionalIntelligence = buildInstitutionalIntelligence(payload.benchmarkSuite ?? payload.benchmarkComparison ?? null, payload.committee ?? null, now);

    return Response.json({
      ...payload,
      committeeImpact: buildCommitteeShadowImpactReport(impact, now),
      committeeImpactStatus: { available: impactError === null, error: impactError, failOpenForPaper: true, changesTradingDecision: false, liveTrading: false },
      paperEvidenceLedger: buildPaperEvidenceLedgerReport(evidence, now),
      paperEvidenceLedgerStatus: { available: evidenceError === null, error: evidenceError, persistedOnThisRequest: shouldPersistSnapshot && evidenceError === null, failOpenForPaper: true, changesTradingDecision: false, liveTrading: false },
      newsIntelligence,
      marketProductIntelligence,
      institutionalIntelligence,
      intelligencePolicy: {
        newsMayVetoPaperEntry: false,
        thirdPartyPortfolioMayTriggerTrade: false,
        unverifiedWinRatesAccepted: false,
        autonomousParameterMutation: false,
        advisoryOnlyUntilValidated: true,
        liveTrading: false,
      },
      temporalValidation,
      costSequenceStress,
      liveTrading: false,
    }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const response = await super.fetch(request);
    if (request.method === "POST" && url.pathname === "/reset") {
      await Promise.allSettled([this.auxiliaryStorage.delete(COMMITTEE_IMPACT_KEY), this.auxiliaryStorage.delete(PAPER_EVIDENCE_KEY)]);
      return response;
    }
    if (!response.ok) return response;
    if (request.method === "POST" && url.pathname === "/tick") return this.enrichLabResponse(response, true);
    if (request.method === "GET" && url.pathname === "/status") return this.enrichLabResponse(response, false);
    return response;
  }
}
