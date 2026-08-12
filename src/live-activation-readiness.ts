import type { Env } from "./types";

export interface LiveActivationReadiness {
  tradingMode: string | null;
  liveTradingEnabledConfigured: boolean;
  liveTradingEnabledRequested: boolean;
  configurationReadyForLiveReview: boolean;
  submissionHardBlocked: true;
  failClosed: true;
  requiredVariableName: "LIVE_TRADING_ENABLED";
}

export function liveArmingConfigurationStatus(env: Pick<Env, "TRADING_MODE" | "LIVE_TRADING_ENABLED">): LiveActivationReadiness {
  const tradingMode = env.TRADING_MODE?.trim() || null;
  const rawGate = env.LIVE_TRADING_ENABLED?.trim();
  const liveTradingEnabledConfigured = typeof rawGate === "string" && rawGate.length > 0;
  const liveTradingEnabledRequested = rawGate === "true";

  return {
    tradingMode,
    liveTradingEnabledConfigured,
    liveTradingEnabledRequested,
    configurationReadyForLiveReview: tradingMode === "live" && liveTradingEnabledRequested,
    submissionHardBlocked: true,
    failClosed: true,
    requiredVariableName: "LIVE_TRADING_ENABLED",
  };
}
