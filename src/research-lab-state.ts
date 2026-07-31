import { DurableObject } from "cloudflare:workers";
import { fetchOhlc } from "./kraken";
import type { MarketUniverse } from "./market-universe";
import {
  applyResearchCandles,
  initializeResearchLab,
  isStrategyDue,
  recordResearchError,
  summarizeResearchLab,
  type ResearchLabState as StoredResearchLabState,
} from "./research-lab";
import type { Env } from "./types";

const STORAGE_KEY = "multi-horizon-paper-lab";

function validUniverse(value: unknown): value is MarketUniverse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketUniverse>;
  return candidate.schemaVersion === "kraken-eur-market-universe-v1"
    && typeof candidate.generatedAt === "number"
    && candidate.topByLane !== undefined;
}

export class ResearchLabState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async read(): Promise<StoredResearchLabState | null> {
    const stored = await this.ctx.storage.get<StoredResearchLabState>(STORAGE_KEY);
    if (!stored || stored.schemaVersion !== "multi-horizon-paper-lab-v1") return null;
    return {
      ...stored,
      version: "0.15.0-paper",
      mode: "paper",
      liveTrading: false,
      strategies: Array.isArray(stored.strategies) ? stored.strategies : [],
    };
  }

  private async write(state: StoredResearchLabState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, {
      ...state,
      version: "0.15.0-paper",
      mode: "paper",
      liveTrading: false,
    });
  }

  private async tick(universe: MarketUniverse): Promise<Response> {
    const now = Date.now();
    let state = await this.read();
    if (!state) state = initializeResearchLab(universe, now);

    const due = state.strategies.filter((strategy) => isStrategyDue(strategy, now));
    for (const strategy of due) {
      try {
        const candles = await fetchOhlc(strategy.pairKey, strategy.config.intervalMinutes);
        applyResearchCandles(strategy, candles, now);
      } catch (error) {
        recordResearchError(strategy, error, now);
      }
    }

    state.cycles += 1;
    state.lastCycleAt = now;
    await this.write(state);
    return Response.json({
      initialized: true,
      dueStrategiesProcessed: due.length,
      state,
      summary: summarizeResearchLab(state, now),
      liveTrading: false,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/status") {
      const state = await this.read();
      if (!state) {
        return Response.json({
          initialized: false,
          mode: "paper",
          message: "El laboratorio se inicializará con el próximo mapa de mercados válido.",
          eligibleForLiveReview: false,
          liveTrading: false,
        });
      }
      return Response.json({
        initialized: true,
        state,
        summary: summarizeResearchLab(state),
        liveTrading: false,
      });
    }

    if (request.method === "POST" && url.pathname === "/tick") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "INVALID_MARKET_UNIVERSE_JSON", liveTrading: false },
          { status: 400 },
        );
      }
      if (!validUniverse(body)) {
        return Response.json(
          { error: "INVALID_MARKET_UNIVERSE", liveTrading: false },
          { status: 422 },
        );
      }
      return this.tick(body);
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      await this.ctx.storage.delete(STORAGE_KEY);
      return Response.json({
        reset: true,
        initialized: false,
        message: "Laboratorio PAPER reiniciado; no se ha tocado ninguna cuenta real.",
        liveTrading: false,
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
