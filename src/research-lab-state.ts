import {
  applyCommitteeTradeSnapshot,
  buildCommitteeShadowImpactReport,
  emptyCommitteeShadowImpactState,
  sanitizeCommitteeShadowImpactState,
  type CommitteeShadowImpactState,
} from "./committee-shadow-impact";
import type { ResearchCommitteeReport } from "./decision-committee";
import type { ResearchLabState as StoredResearchLabState } from "./research-lab";
import { ResearchLabState as BaseResearchLabState } from "./research-lab-state-base";
import type { Env } from "./types";

const COMMITTEE_IMPACT_KEY = "committee-shadow-impact-v1";

interface LabResponsePayload {
  initialized?: boolean;
  state?: StoredResearchLabState;
  committee?: ResearchCommitteeReport;
  [key: string]: unknown;
}

function validCommittee(value: unknown): value is ResearchCommitteeReport {
  return Boolean(
    value
    && typeof value === "object"
    && (value as ResearchCommitteeReport).schemaVersion === "paper-research-committee-v1"
    && Array.isArray((value as ResearchCommitteeReport).reports),
  );
}

export class ResearchLabState extends BaseResearchLabState {
  private readonly impactStorage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.impactStorage = ctx.storage;
  }

  private async readImpact(now = Date.now()): Promise<CommitteeShadowImpactState> {
    return sanitizeCommitteeShadowImpactState(
      await this.impactStorage.get<unknown>(COMMITTEE_IMPACT_KEY),
      now,
    );
  }

  private async enrichLabResponse(
    response: Response,
    shouldPersistSnapshot: boolean,
    now = Date.now(),
  ): Promise<Response> {
    let payload: LabResponsePayload;
    try {
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) return response;
      payload = value as LabResponsePayload;
    } catch {
      return response;
    }

    let impact = await this.readImpact(now);
    if (
      shouldPersistSnapshot
      && payload.initialized === true
      && payload.state
      && Array.isArray(payload.state.strategies)
    ) {
      impact = applyCommitteeTradeSnapshot(
        impact,
        payload.state.strategies,
        validCommittee(payload.committee) ? payload.committee : null,
        now,
      );
      await this.impactStorage.put(COMMITTEE_IMPACT_KEY, impact);
    }

    return Response.json({
      ...payload,
      committeeImpact: buildCommitteeShadowImpactReport(impact, now),
      liveTrading: false,
    }, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const response = await super.fetch(request);

    if (request.method === "POST" && url.pathname === "/reset") {
      await this.impactStorage.delete(COMMITTEE_IMPACT_KEY);
      return response;
    }

    if (!response.ok) return response;
    if (request.method === "POST" && url.pathname === "/tick") {
      return this.enrichLabResponse(response, true);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return this.enrichLabResponse(response, false);
    }
    return response;
  }
}
