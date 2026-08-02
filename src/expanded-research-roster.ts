import type { MarketCandidate, MarketUniverse, ResearchLaneId } from "./market-universe";
import { PAPER_ROSTER_LIMITS } from "./paper-roster-policy";

export interface ExpandedRosterCandidate {
  lane: ResearchLaneId;
  candidate: MarketCandidate;
}

export function selectExpandedResearchRoster(universe: MarketUniverse): ExpandedRosterCandidate[] {
  const selected: ExpandedRosterCandidate[] = [];
  for (const lane of ["fast", "intraday", "swing"] as const) {
    for (const candidate of universe.topByLane[lane].slice(0, PAPER_ROSTER_LIMITS[lane])) {
      selected.push({ lane, candidate });
    }
  }
  return selected;
}

export function summarizeExpandedResearchRoster(universe: MarketUniverse): Record<string, unknown> {
  const selected = selectExpandedResearchRoster(universe);
  return {
    strategyCount: selected.length,
    byLane: {
      fast: selected.filter((item) => item.lane === "fast").length,
      intraday: selected.filter((item) => item.lane === "intraday").length,
      swing: selected.filter((item) => item.lane === "swing").length,
    },
    maximumStrategies: Object.values(PAPER_ROSTER_LIMITS).reduce((sum, value) => sum + value, 0),
    thresholdsUnchanged: true,
    sizingUnchanged: true,
    liveTrading: false,
  };
}
