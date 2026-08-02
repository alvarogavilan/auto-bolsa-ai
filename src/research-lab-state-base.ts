import { DurableObject } from "cloudflare:workers";
import { buildBenchmarkSuite } from "./benchmark-suite";
import { buildResearchCommitteeReport } from "./decision-committee";
import { fetchOhlc } from "./kraken";
import type { MarketUniverse } from "./market-universe";
import { buildNewsDecisionContext } from "./news-decision-context";
import { buildNewsIntelligence } from "./news-intelligence";
import {
  applyResearchCandles,
  initializeResearchLab,
  isStrategyDue,
  reconcileResearchLab,
  recordResearchError,
  summarizeResearchLab,
  type FastEntryGate,
  type ResearchLabState as StoredResearchLabState,
} from "./research-lab-adaptive";
import { buildShadowLiveDemo } from "./shadow-live-demo";
import {
  buildBenchmarkComparison,
  sanitizeBenchmarkMap,
  updateBuyHoldBenchmark,
  type PaperBenchmarkMap,
} from "./strategy-benchmark";
import type { Env } from "./types";

const STORAGE_KEY = "multi-horizon-paper-lab";
const EXECUTION_GATES_KEY = "fast-execution-gates";
const BENCHMARKS_KEY = "paper-buy-hold-benchmarks";

type FastExecutionGates = Record<string, FastEntryGate>;
interface ResearchLabTickPayload { universe: MarketUniverse; executionGates: FastExecutionGates; }

function validUniverse(value: unknown): value is MarketUniverse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketUniverse>;
  return candidate.schemaVersion === "kraken-eur-market-universe-v1" && typeof candidate.generatedAt === "number" && candidate.topByLane !== undefined;
}
function validGate(value: unknown): value is FastEntryGate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FastEntryGate>;
  return typeof candidate.checkedAt === "number" && typeof candidate.allowed === "boolean" && (candidate.costPct === null || typeof candidate.costPct === "number") && (candidate.blocker === null || typeof candidate.blocker === "string");
}
function sanitizeGates(value: unknown): FastExecutionGates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const gates: FastExecutionGates = {};
  for (const [pairKey, gate] of Object.entries(value)) if (validGate(gate)) gates[pairKey] = gate;
  return gates;
}
function parseTickPayload(value: unknown): ResearchLabTickPayload | null {
  if (validUniverse(value)) return { universe: value, executionGates: {} };
  if (!value || typeof value !== "object") return null;
  const candidate = value as { universe?: unknown; executionGates?: unknown };
  if (!validUniverse(candidate.universe)) return null;
  return { universe: candidate.universe, executionGates: sanitizeGates(candidate.executionGates) };
}

export class ResearchLabState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); }
  private async read(): Promise<StoredResearchLabState | null> {
    const stored = await this.ctx.storage.get<StoredResearchLabState>(STORAGE_KEY);
    if (!stored || stored.schemaVersion !== "multi-horizon-paper-lab-v1") return null;
    return { ...stored, version: "0.17.0-paper", mode: "paper", liveTrading: false, strategies: Array.isArray(stored.strategies) ? stored.strategies : [] };
  }
  private async write(state: StoredResearchLabState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, { ...state, version: "0.17.0-paper", mode: "paper", liveTrading: false });
  }
  private async readExecutionGates(): Promise<FastExecutionGates> { return sanitizeGates(await this.ctx.storage.get<unknown>(EXECUTION_GATES_KEY)); }
  private async readBenchmarks(): Promise<PaperBenchmarkMap> { return sanitizeBenchmarkMap(await this.ctx.storage.get<unknown>(BENCHMARKS_KEY)); }
  private executionGateSummary(state: StoredResearchLabState, gates: FastExecutionGates, now = Date.now()): Record<string, unknown> {
    const fastStrategies = state.strategies.filter((strategy) => strategy.lane === "fast");
    const strategies = fastStrategies.map((strategy) => {
      const gate = gates[strategy.pairKey] ?? null;
      const stale = gate ? now - gate.checkedAt > 10 * 60_000 : true;
      return { pairKey: strategy.pairKey, symbol: strategy.symbol, gateAvailable: gate !== null, checkedAt: gate?.checkedAt ?? null, stale, entryAllowed: gate !== null && !stale && gate.allowed, immediateRoundTripCostPct: gate?.costPct ?? null, blocker: gate === null ? "execution-evidence-unavailable" : stale ? "execution-evidence-stale" : gate.blocker, positionOpen: strategy.position !== null };
    });
    return { schemaVersion: "fast-entry-execution-gates-v1", requiredForNewFastEntries: true, safetyExitsRemainAllowed: true, fastStrategyCount: fastStrategies.length, gatesAvailable: strategies.filter((strategy) => strategy.gateAvailable).length, entriesCurrentlyAllowed: strategies.filter((strategy) => strategy.entryAllowed).length, strategies, liveTrading: false };
  }
  private buildAnalysis(state: StoredResearchLabState, gates: FastExecutionGates, benchmarks: PaperBenchmarkMap, now: number): Record<string, unknown> {
    return { summary: summarizeResearchLab(state, now), shadowLiveDemo: buildShadowLiveDemo(state, gates, benchmarks, now), fastExecutionGates: this.executionGateSummary(state, gates, now), benchmarkComparison: buildBenchmarkComparison(state.strategies, benchmarks), benchmarkSuite: buildBenchmarkSuite(state.strategies, benchmarks), committee: buildResearchCommitteeReport(state, gates, benchmarks, now) };
  }
  private async tick(payload: ResearchLabTickPayload): Promise<Response> {
    const now = Date.now();
    let state = await this.read();
    if (!state) state = initializeResearchLab(payload.universe, now); else state = reconcileResearchLab(state, payload.universe, now);
    const [benchmarks, news] = await Promise.all([this.readBenchmarks(), buildNewsIntelligence(now)]);
    const due = state.strategies.filter((strategy) => isStrategyDue(strategy, now));
    for (const strategy of due) {
      try {
        const candles = await fetchOhlc(strategy.pairKey, strategy.config.intervalMinutes);
        const currentPrice = candles.at(-1)?.close;
        if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error("Kraken OHLC current price unavailable for benchmark");
        benchmarks[strategy.id] = updateBuyHoldBenchmark(benchmarks[strategy.id] ?? null, strategy, currentPrice, now);
        const newsContext = buildNewsDecisionContext(news, strategy.base);
        applyResearchCandles(strategy, candles, now, payload.executionGates[strategy.pairKey] ?? null, newsContext);
      } catch (error) { recordResearchError(strategy, error, now); }
    }
    state.cycles += 1; state.lastCycleAt = now;
    await Promise.all([this.write(state), this.ctx.storage.put(EXECUTION_GATES_KEY, payload.executionGates), this.ctx.storage.put(BENCHMARKS_KEY, benchmarks)]);
    return Response.json({ initialized: true, dueStrategiesProcessed: due.length, state, newsAppliedToPaper: true, ...this.buildAnalysis(state, payload.executionGates, benchmarks, now), liveTrading: false });
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const [state, executionGates, benchmarks] = await Promise.all([this.read(), this.readExecutionGates(), this.readBenchmarks()]);
      if (!state) return Response.json({ initialized: false, mode: "paper", message: "El laboratorio se inicializará con el próximo mapa de mercados válido.", eligibleForLiveReview: false, liveTrading: false });
      const now = Date.now();
      return Response.json({ initialized: true, state, newsAppliedToPaper: true, ...this.buildAnalysis(state, executionGates, benchmarks, now), liveTrading: false });
    }
    if (request.method === "POST" && url.pathname === "/tick") {
      let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "INVALID_RESEARCH_LAB_JSON", liveTrading: false }, { status: 400 }); }
      const payload = parseTickPayload(body);
      if (!payload) return Response.json({ error: "INVALID_RESEARCH_LAB_PAYLOAD", liveTrading: false }, { status: 422 });
      return this.tick(payload);
    }
    if (request.method === "POST" && url.pathname === "/reset") {
      await Promise.all([this.ctx.storage.delete(STORAGE_KEY), this.ctx.storage.delete(EXECUTION_GATES_KEY), this.ctx.storage.delete(BENCHMARKS_KEY)]);
      return Response.json({ reset: true, initialized: false, message: "Laboratorio PAPER reiniciado; no se ha tocado ninguna cuenta real.", liveTrading: false });
    }
    return new Response("Not found", { status: 404 });
  }
}
