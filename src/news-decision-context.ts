import type { NewsIntelligenceReport } from "./news-intelligence";

export interface NewsDecisionContext {
  schemaVersion: "news-decision-context-v1";
  asset: string;
  relevantSignals: number;
  riskScore: number;
  supportScore: number;
  sizeFactor: number;
  vetoNewLong: boolean;
  reasons: string[];
  liveTrading: false;
}

export function buildNewsDecisionContext(report: NewsIntelligenceReport, asset: string): NewsDecisionContext {
  const upper = asset.toUpperCase();
  const relevant = report.signals.filter((signal) =>
    signal.assets.some((item) => item.toUpperCase() === upper || item.toUpperCase() === "CRYPTO"),
  ).slice(0, 20);
  let riskScore = 0;
  let supportScore = 0;
  for (const signal of relevant) {
    const weight = (signal.impactScore / 100) * signal.confidence * (signal.corroboratingSources > 1 ? 1.15 : 1);
    if (signal.direction === "risk-off") riskScore += weight;
    if (signal.direction === "risk-on") supportScore += weight;
  }
  const net = supportScore - riskScore;
  const vetoNewLong = riskScore >= 1.4 && riskScore > supportScore * 1.5;
  const sizeFactor = vetoNewLong ? 0 : Math.max(0.35, Math.min(1.15, 0.8 + net * 0.18));
  return {
    schemaVersion: "news-decision-context-v1",
    asset: upper,
    relevantSignals: relevant.length,
    riskScore,
    supportScore,
    sizeFactor,
    vetoNewLong,
    reasons: relevant.slice(0, 5).map((signal) => `${signal.urgency}/${signal.direction}: ${signal.title}`),
    liveTrading: false,
  };
}
