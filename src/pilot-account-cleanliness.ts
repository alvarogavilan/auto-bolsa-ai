import {
  KrakenReadOnlyAccountGateway,
  type KrakenAccountCleanlinessAudit,
} from "./live-order-preflight";
import {
  acquireKrakenPrivateLease,
  releaseKrakenPrivateLease,
} from "./kraken-private-lease";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const CACHE_TTL_SECONDS = 10 * 60;

function cacheKey(): Request {
  return new Request("https://cache.auto-bolsa-ai.internal/pilot-account-cleanliness-v1");
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function nextSharedNonce(env: Env): Promise<string> {
  const botState = env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
  const response = await botState.fetch("https://bot/kraken/next-nonce", { method: "POST" });
  if (!response.ok) throw new Error(`Nonce authority HTTP ${response.status}`);
  const body = await responseObject(response);
  if (typeof body.nonce !== "string" || !body.nonce) {
    throw new Error("Nonce authority returned no nonce");
  }
  return body.nonce;
}

export async function auditPilotAccountCleanliness(
  env: Env,
  forceRefresh = false,
): Promise<KrakenAccountCleanlinessAudit> {
  if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
    throw new Error("Kraken credentials are not configured");
  }

  const cache = caches.default;
  const key = cacheKey();
  if (!forceRefresh) {
    const cached = await cache.match(key);
    if (cached) return cached.json<KrakenAccountCleanlinessAudit>();
  }

  const leaseId = await acquireKrakenPrivateLease(env, `pilot-account-cleanliness:${crypto.randomUUID()}`);
  try {
    const gateway = new KrakenReadOnlyAccountGateway(
      env.KRAKEN_API_KEY,
      env.KRAKEN_API_SECRET,
      () => nextSharedNonce(env),
    );
    const audit = await gateway.audit();
    await cache.put(
      key,
      Response.json(audit, {
        headers: { "Cache-Control": `private, max-age=${CACHE_TTL_SECONDS}` },
      }),
    );
    return audit;
  } finally {
    await releaseKrakenPrivateLease(env, leaseId).catch(() => undefined);
  }
}

export function applyAccountCleanlinessToReadiness(
  body: Record<string, unknown>,
  audit: KrakenAccountCleanlinessAudit | null,
  error: string | null,
): Record<string, unknown> {
  const blockers = Array.isArray(body.blockers)
    ? body.blockers.filter((item): item is string => typeof item === "string")
    : [];
  const passedChecks = Array.isArray(body.passedChecks)
    ? body.passedChecks.filter((item): item is string => typeof item === "string")
    : [];

  if (!audit) {
    blockers.push("La limpieza de la cuenta Kraken no se pudo verificar");
  } else if (!audit.accountCleanForBaseline) {
    blockers.push(...audit.blockers);
  } else {
    passedChecks.push("Cuenta Kraken limpia: sin activos no EUR ni órdenes abiertas");
  }

  const originalEligible = body.infrastructureEligibleForManualReview === true;
  const eligible = originalEligible && audit?.accountCleanForBaseline === true;
  return {
    ...body,
    accountCleanliness: audit
      ? { available: true, error: null, ...audit }
      : {
          schemaVersion: "kraken-account-cleanliness-v1",
          available: false,
          error,
          readOnly: true,
          realOrderCreated: false,
          liveTrading: false,
        },
    blockers,
    passedChecks,
    infrastructureEligibleForManualReview: eligible,
    message: eligible
      ? "Infraestructura elegible para revisión humana. El envío real continúa sin ruta y sin activación."
      : `Piloto todavía bloqueado por ${blockers.length} condición(es).`,
    liveTrading: false,
  };
}

export async function enrichReadinessWithAccountCleanliness(
  response: Response,
  env: Env,
  forceRefresh = false,
): Promise<Response> {
  if (!response.ok) return response;
  const body = await responseObject(response);
  if (Object.keys(body).length === 0) return response;

  let audit: KrakenAccountCleanlinessAudit | null = null;
  let error: string | null = null;
  try {
    audit = await auditPilotAccountCleanliness(env, forceRefresh);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Kraken account audit failed";
  }

  return Response.json(applyAccountCleanlinessToReadiness(body, audit, error), {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
