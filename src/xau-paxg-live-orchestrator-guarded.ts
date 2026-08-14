import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { calculateXauMicroLiveReadiness } from "./xau-live-readiness";
import {
  runXauPaxgLiveCycle as runBaseXauPaxgLiveCycle,
  type XauPaxgLiveCycleResult,
} from "./xau-paxg-live-orchestrator";
import { runXauPaxgManualAlertCycle } from "./xau-paxg-manual-alert-orchestrator";

function bot(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

/**
 * Autoridad final del ciclo XAU/PAXG.
 *
 * - Si LIVE real no está armado, NO prepara ni envía órdenes: transforma una
 *   decisión aprobada en una alerta de ejecución manual por Telegram.
 * - Si LIVE real estuviera armado externamente, conserva la ruta certificada
 *   original y todos sus gates de evidencia.
 */
export async function runXauPaxgLiveCycle(
  env: Env,
): Promise<XauPaxgLiveCycleResult | Awaited<ReturnType<typeof runXauPaxgManualAlertCycle>>> {
  const liveEnabled = env.LIVE_TRADING_ENABLED === "true"
    && env.TRADING_MODE === "live"
    && (env.PAIR || "") === "PAXGEUR";

  if (!liveEnabled) return runXauPaxgManualAlertCycle(env);

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
