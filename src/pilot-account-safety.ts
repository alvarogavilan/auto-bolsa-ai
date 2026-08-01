import {
  BOT_STATE_SINGLETON_NAME,
  type Env,
} from "./types";

export interface PilotAccountConnectionSafety {
  checkedAt: number;
  configured: boolean;
  connected: boolean;
  eurBalance: number | null;
  nonZeroAssetCount: number | null;
  openOrderCount: number | null;
  accountClean: boolean;
  error: string | null;
}

export interface PilotAccountPermissionSafety {
  checkedAt: number;
  auditComplete: boolean;
  safePermissions: boolean;
  withdrawalPermission: boolean | null;
  depositPermission: boolean | null;
  earnPermission: boolean | null;
  error: string | null;
}

export interface PilotAccountSafety {
  connection: PilotAccountConnectionSafety;
  permissions: PilotAccountPermissionSafety;
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function errorOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Lee la conexión, saldos, órdenes abiertas y permisos exclusivamente a través
 * de BotState, que conserva la autoridad única y persistente de nonce.
 */
export async function fetchPilotAccountSafety(env: Env): Promise<PilotAccountSafety> {
  const stub = botState(env);
  const connectionResponse = await stub.fetch("https://bot/kraken/connection");
  const connection = await responseObject(connectionResponse);
  const permissionsResponse = await stub.fetch("https://bot/kraken/permissions");
  const permissions = await responseObject(permissionsResponse);
  const now = Date.now();

  const nonZeroAssetCount = finiteOrNull(connection.nonZeroAssetCount);
  const openOrderCount = finiteOrNull(connection.openOrderCount);
  const accountClean = connectionResponse.ok
    && connection.connected === true
    && connection.accountClean === true
    && nonZeroAssetCount === 1
    && openOrderCount === 0;

  return {
    connection: {
      checkedAt: now,
      configured: connection.configured === true,
      connected: connectionResponse.ok && connection.connected === true,
      eurBalance: finiteOrNull(connection.eurBalance),
      nonZeroAssetCount,
      openOrderCount,
      accountClean,
      error: errorOrNull(connection.error) ?? (connectionResponse.ok ? null : `HTTP ${connectionResponse.status}`),
    },
    permissions: {
      checkedAt: now,
      auditComplete: permissionsResponse.ok && permissions.auditComplete === true,
      safePermissions: permissionsResponse.ok && permissions.safePermissions === true,
      withdrawalPermission: boolOrNull(permissions.withdrawalPermission),
      depositPermission: boolOrNull(permissions.depositPermission),
      earnPermission: boolOrNull(permissions.earnPermission),
      error: errorOrNull(permissions.error) ?? (permissionsResponse.ok ? null : `HTTP ${permissionsResponse.status}`),
    },
  };
}
