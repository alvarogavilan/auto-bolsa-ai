import type { MarketUniverse, ResearchLaneId } from "./market-universe";

export const PAPER_ROSTER_LIMITS: Record<ResearchLaneId, number> = {
  fast: 5,
  intraday: 8,
  swing: 12,
};

export interface PaperRosterPlan {
  limits: Record<ResearchLaneId, number>;
  selectedByLane: Record<ResearchLaneId, string[]>;
  selectedStrategies: number;
  availableByLane: Record<ResearchLaneId, number>;
  liveTrading: false;
}

export function buildPaperRosterPlan(universe: MarketUniverse): PaperRosterPlan {
  const selectedByLane = {
    fast: universe.topByLane.fast.slice(0, PAPER_ROSTER_LIMITS.fast).map((candidate) => candidate.pairKey),
    intraday: universe.topByLane.intraday.slice(0, PAPER_ROSTER_LIMITS.intraday).map((candidate) => candidate.pairKey),
    swing: universe.topByLane.swing.slice(0, PAPER_ROSTER_LIMITS.swing).map((candidate) => candidate.pairKey),
  };

  return {
    limits: PAPER_ROSTER_LIMITS,
    selectedByLane,
    selectedStrategies: selectedByLane.fast.length + selectedByLane.intraday.length + selectedByLane.swing.length,
    availableByLane: {
      fast: universe.topByLane.fast.length,
      intraday: universe.topByLane.intraday.length,
      swing: universe.topByLane.swing.length,
    },
    liveTrading: false,
  };
}
