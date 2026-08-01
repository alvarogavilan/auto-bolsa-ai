import type { StrategyBenchmarkSuite } from "./benchmark-suite";
import {
  advanceFrozenForwardExperiment,
  buildFrozenForwardReport,
  frozenManifestHash,
  sanitizeFrozenForwardExperiment,
  type FrozenForwardExperimentState,
} from "./frozen-forward-experiment";
import type { ResearchLabState as StoredResearchLabState } from "./research-lab";
import { ResearchLabState as ImpactResearchLabState } from "./research-lab-state-impact";
import type { Env } from "./types";

const FROZEN_FORWARD_KEY = "frozen-forward-experiment-v1";

interface LabPayload {
  initialized?: boolean;
  state?: StoredResearchLabState;
  benchmarkSuite?: StrategyBenchmarkSuite;
  [key: string]: unknown;
}

interface FrozenStateRead {
  state: FrozenForwardExperimentState | null;
  error: string | null;
}

function validSuite(value: unknown): value is StrategyBenchmarkSuite {
  return Boolean(
    value
    && typeof value === "object"
    && (value as StrategyBenchmarkSuite).schemaVersion === "paper-benchmark-suite-v1"
    && Array.isArray((value as StrategyBenchmarkSuite).entries),
  );
}

export class ResearchLabState extends ImpactResearchLabState {
  private readonly forwardStorage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.forwardStorage = ctx.storage;
  }

  private async readFrozenState(): Promise<FrozenStateRead> {
    try {
      const raw = await this.forwardStorage.get<unknown>(FROZEN_FORWARD_KEY);
      if (raw === undefined) return { state: null, error: null };
      const state = sanitizeFrozenForwardExperiment(raw);
      return state
        ? { state, error: null }
        : { state: null, error: "FROZEN_FORWARD_STATE_INVALID" };
    } catch {
      return { state: null, error: "FROZEN_FORWARD_STORAGE_READ_FAILED" };
    }
  }

  private async enrichForward(
    response: Response,
    shouldAdvance: boolean,
    now = Date.now(),
  ): Promise<Response> {
    let payload: LabPayload;
    try {
      const value = await response.clone().json();
      if (!value || typeof value !== "object" || Array.isArray(value)) return response;
      payload = value as LabPayload;
    } catch {
      return response;
    }

    const strategies = payload.state?.strategies;
    if (payload.initialized !== true || !Array.isArray(strategies)) {
      return Response.json({
        ...payload,
        frozenForwardExperiment: null,
        frozenForwardStatus: {
          initialized: false,
          available: true,
          error: null,
          startsOnNextValidCycle: true,
          failOpenForPaper: true,
          changesTradingDecision: false,
          liveTrading: false,
        },
        liveTrading: false,
      }, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }

    const suite = validSuite(payload.benchmarkSuite) ? payload.benchmarkSuite : null;
    const read = await this.readFrozenState();
    let state = read.state;
    let report = null;
    let error = read.error;

    if (error === null) {
      try {
        if (shouldAdvance) {
          const advanced = await advanceFrozenForwardExperiment(state, strategies, suite, now);
          state = advanced.state;
          report = advanced.report;
          await this.forwardStorage.put(FROZEN_FORWARD_KEY, state);
        } else if (state) {
          report = buildFrozenForwardReport(
            state,
            strategies,
            suite,
            await frozenManifestHash(strategies),
            now,
          );
        }
      } catch {
        error = shouldAdvance
          ? "FROZEN_FORWARD_ADVANCE_OR_PERSIST_FAILED"
          : "FROZEN_FORWARD_REPORT_FAILED";
      }
    }

    return Response.json({
      ...payload,
      frozenForwardExperiment: report,
      frozenForwardStatus: {
        initialized: state !== null,
        available: error === null,
        error,
        startsOnNextValidCycle: state === null && error === null,
        failOpenForPaper: true,
        changesTradingDecision: false,
        liveTrading: false,
      },
      liveTrading: false,
    }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const response = await super.fetch(request);

    if (request.method === "POST" && url.pathname === "/reset") {
      try {
        await this.forwardStorage.delete(FROZEN_FORWARD_KEY);
      } catch {
        // El reset base ya finalizó; el expediente forward no puede revertirlo.
      }
      return response;
    }

    if (!response.ok) return response;
    if (request.method === "POST" && url.pathname === "/tick") {
      return this.enrichForward(response, true);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return this.enrichForward(response, false);
    }
    return response;
  }
}
