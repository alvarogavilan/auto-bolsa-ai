import worker, {
  BotState,
  ResearchLabState,
  LiveExecutorState,
} from "./index-paper-capital";
import { auditPilotAccountCleanliness } from "./pilot-account-cleanliness";
import { buildPilotRuntimeReadiness } from "./pilot-runtime";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";
import { buildNativeXauPaperInput } from "./xau-native-paper-feed";

export { BotState, ResearchLabState, LiveExecutorState };

const TEMP_SAFE_KRAKEN_PROBE_PATH = "/api/ops/probe/kraken-20260810-ed735d0-b0c214b";

function paperClockAllowed(env: Env): boolean {
  return env.TRADING_MODE === "paper" && env.LIVE_TRADING_ENABLED !== "true";
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function temporarySafeKrakenProbe(env: Env): Promise<Response> {
  try {
    const [runtime, account] = await Promise.all([
      buildPilotRuntimeReadiness(env, true),
      auditPilotAccountCleanliness(env, true),
    ]);
    const kraken = record(runtime.kraken);
    const connection = record(kraken.connection);
    const permissions = record(kraken.permissions);
    const market = record(runtime.market);
    const executor = record(runtime.executor);
    const paper = record(runtime.paper);
    const eurBalance = typeof account.eurBalance === "number" ? account.eurBalance : null;
    const blockers = Array.isArray(runtime.blockers)
      ? runtime.blockers.filter((value): value is string => typeof value === "string")
      : [];

    return Response.json({
      schemaVersion: "temporary-kraken-live-readiness-safe-v1",
      checkedAt: Date.now(),
      broker: "kraken",
      pair: typeof market.pair === "string" ? market.pair : env.PAIR ?? "PAXGEUR",
      privateApiConfigured: connection.configured === true,
      privateApiConnected: connection.connected === true,
      permissionsAuditComplete: permissions.auditComplete === true,
      permissionsSafe: permissions.safePermissions === true,
      withdrawalsDisabled: permissions.withdrawalPermission === false,
      depositsDisabled: permissions.depositPermission === false,
      earnDisabled: permissions.earnPermission === false,
      accountCleanForBaseline: account.accountCleanForBaseline === true,
      noOpenOrders: account.openOrderCount === 0,
      noNonEurAssets: account.nonEurAssetCount === 0,
      eurBalanceAtLeast5: eurBalance !== null && eurBalance >= 5,
      eurBalanceAtLeast10: eurBalance !== null && eurBalance >= 10,
      eurBalanceAtLeast30: eurBalance !== null && eurBalance >= 30,
      pairResolved: market.available !== false && typeof market.canonicalPair === "string",
      paperEligibleForLiveReview: paper.eligibleForLiveReview === true,
      balanceReconciled: executor.lastBalanceCheckStatus === "consistent",
      emergencyStopActive: executor.emergencyStopActive === true,
      manualLiquidationPending: executor.emergencyStopRequiresManualLiquidation === true,
      preparedOrderExists: record(executor.order).status === "prepared",
      infrastructureEligibleForManualReview: runtime.infrastructureEligibleForManualReview === true,
      blockers,
      liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
      tradingMode: env.TRADING_MODE ?? null,
      readOnly: true,
      realOrderCreated: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      schemaVersion: "temporary-kraken-live-readiness-safe-v1",
      checkedAt: Date.now(),
      ready: false,
      error: error instanceof Error ? error.message : "UNKNOWN_KRAKEN_SAFE_PROBE_FAILURE",
      readOnly: true,
      realOrderCreated: false,
      liveTradingEnabled: false,
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

async function runDirectPaperDecision(env: Env): Promise<Record<string, unknown>> {
  const input = await buildNativeXauPaperInput();
  const response = await botState(env).fetch("https://bot/xau/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(`XAU cycle HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === TEMP_SAFE_KRAKEN_PROBE_PATH) {
      if (!paperClockAllowed(env)) {
        return Response.json({
          ok: false,
          blocked: true,
          reason: "TEMP_SAFE_PROBE_REQUIRES_PAPER_MODE",
          liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
          realOrderCreated: false,
        }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      return temporarySafeKrakenProbe(env);
    }

    if (request.method === "POST" && url.pathname === "/api/xau/paper-clock") {
      if (!paperClockAllowed(env)) {
        return Response.json({
          ok: false,
          blocked: true,
          reason: "PAPER_ONLY_CLOCK",
          mode: env.TRADING_MODE,
          liveTrading: env.LIVE_TRADING_ENABLED === "true",
          realOrderSubmission: false,
        }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }

      try {
        const cycle = await runDirectPaperDecision(env);
        return Response.json({
          ok: true,
          source: "github-actions-paper-fallback",
          invokedAt: Date.now(),
          cycle,
          mode: "paper",
          liveTrading: false,
          realOrderSubmission: false,
        }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({
          ok: false,
          source: "github-actions-paper-fallback",
          error: error instanceof Error ? error.message : "UNKNOWN_XAU_PAPER_CLOCK_ERROR",
          mode: "paper",
          liveTrading: false,
          realOrderSubmission: false,
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(controller, env, ctx);
  },
};
