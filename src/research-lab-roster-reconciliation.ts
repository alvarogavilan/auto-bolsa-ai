import type { MarketUniverse } from "./market-universe";
import { initializeResearchLab, type ResearchLabState } from "./research-lab";

export interface ResearchLabRosterReconciliation {
  state: ResearchLabState;
  previousStrategyCount: number;
  addedStrategyCount: number;
  preservedStrategyCount: number;
  liveTrading: false;
}

/**
 * Expands a persisted PAPER laboratory to the current configured roster without
 * resetting positions, trades, balances, errors, clocks or cohort dates.
 * Existing strategies always remain authoritative; only missing eligible
 * strategies are appended from a freshly generated roster.
 */
export function reconcileResearchLabRoster(
  persisted: ResearchLabState,
  universe: MarketUniverse,
  now = Date.now(),
): ResearchLabRosterReconciliation {
  const desired = initializeResearchLab(universe, now);
  const existingIds = new Set(persisted.strategies.map((strategy) => strategy.id));
  const missing = desired.strategies.filter((strategy) => !existingIds.has(strategy.id));

  return {
    state: {
      ...persisted,
      sourceUniverseGeneratedAt: universe.generatedAt,
      strategies: [...persisted.strategies, ...missing],
      liveTrading: false,
    },
    previousStrategyCount: persisted.strategies.length,
    addedStrategyCount: missing.length,
    preservedStrategyCount: persisted.strategies.length,
    liveTrading: false,
  };
}
