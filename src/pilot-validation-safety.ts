import type { KrakenEffectiveFeesAudit } from "./kraken-fees";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

export interface PilotValidationConnectionSafety {
  checkedAt: number;
  configured: boolean;
  connected: boolean;
  effectiveFees: KrakenEffectiveFeesAudit | null;
  effectiveFeesError: string | null;
  error: string | null;
}

export interface PilotValidationPermissionSafety {
  checkedAt: number;
  auditComplete: boolean;
  safePermissions: boolean;
  withdrawalPermission: boolean | null;
  depositPermission: boolean | null;
  earnPermission: boolean | null;
  error: string | null;
}

export interface PilotValidationSafety {
  connection: PilotValidationConnectionSafety;
  permissions: PilotValidationPermissionSafety;
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

function errorOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function effectiveFeesOrNull(value: unknown): KrakenEffectiveFeesAudit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audit = value as Partial<KrakenEffectiveFeesAudit>;
  return audit.schemaVersion === "kraken-effective-fees-v1"
    ? audit as KrakenEffectiveFeesAudit
    : null;
}

/**
 * Ejecuta conexión y permisos en secuencia a través de BotState. La respuesta
 * de conexión ya contiene la auditoría de tarifas obtenida en la misma
 * concesión privada; no se realiza una lectura Kraken adicional para fees.
 */
export async function fetchPilotValidationSafety(env: Env): Promise<PilotValidationSafety> {
  const stub = botState(env);
  const connectionResponse = await stub.fetch("https://bot/kraken/connection");
  const connectionBody = await responseObject(connectionResponse);
  const permissionsResponse = await stub.fetch("https://bot/kraken/permissions");
  const permissionsBody = await responseObject(permissionsResponse);
  const feeStatus = connectionBody.effectiveFeesStatus && typeof connectionBody.effectiveFeesStatus === "object"
    ? connectionBody.effectiveFeesStatus as Record<string, unknown>
    : {};
  const now = Date.now();

  return {
    connection: {
      checkedAt: now,
      configured: connectionBody.configured === true,
      connected: connectionResponse.ok && connectionBody.connected === true,
      effectiveFees: effectiveFeesOrNull(connectionBody.effectiveFees),
      effectiveFeesError: errorOrNull(feeStatus.error),
      error: errorOrNull(connectionBody.error) ?? (connectionResponse.ok ? null : `HTTP ${connectionResponse.status}`),
    },
    permissions: {
      checkedAt: now,
      auditComplete: permissionsResponse.ok && permissionsBody.auditComplete === true,
      safePermissions: permissionsResponse.ok && permissionsBody.safePermissions === true,
      withdrawalPermission: boolOrNull(permissionsBody.withdrawalPermission),
      depositPermission: boolOrNull(permissionsBody.depositPermission),
      earnPermission: boolOrNull(permissionsBody.earnPermission),
      error: errorOrNull(permissionsBody.error) ?? (permissionsResponse.ok ? null : `HTTP ${permissionsResponse.status}`),
    },
  };
}
