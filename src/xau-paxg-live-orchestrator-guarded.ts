import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { calculateXauMicroLiveReadiness } from "./xau-live-readiness";
import {
  runXauPaxgLiveCycle as runBaseXauPaxgLiveCycle,
  type XauPaxgLiveCycleResult,
} from "./xau-paxg-live-orchestrator";

function bot(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

/**
 * Autoridad final antes de cualquier ciclo real de oro.
 * Mantiene intacto el gate PAPER general para escalar capital, pero el piloto
 * de ejecución de <=5 EUR se gobierna exclusivamente con evidencia XAU propia.
 */
export async function runXauPaxgLiveCycle(env: Env): Promise<XauPaxgLiveCycleResult> {
  const liveEnabled = env.LIVE_TRADING_ENABLED === "true"
    && env.TRADING_MODE === "live"
    && (env.PAIR || "") === "PAXGEUR";

  if (!liveEnabled) return runBaseXauPaxgLiveCycle(env);

  const response = await bot(env).fetch("https://bot/xau/status");
  if (!response.ok) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "blocked",
      reason: `No se pudo verificar la evidencia XAU del piloto (HTTP ${response.status})`,
      liveTradingEnabled: true,
    };
  }

  const status = await response.json<unknown>();
  const readiness = calculateXauMicroLiveReadiness(status);
  if (!readiness.eligible) {
    return {
      schemaVersion: "xau-paxg-live-cycle-v1",
      ran: false,
      action: "blocked",
      reason: `Piloto XAU no elegible: ${readiness.blockers.join("; ")}`,
      detail: readiness,
      liveTradingEnabled: true,
    };
  }

  return runBaseXauPaxgLiveCycle(env);
}
