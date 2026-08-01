import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

export const KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH = "/kraken/private-lease/acquire";
export const KRAKEN_PRIVATE_LEASE_RELEASE_PATH = "/kraken/private-lease/release";
export const KRAKEN_PRIVATE_LEASE_TTL_MS = 120_000;
export const KRAKEN_PRIVATE_LEASE_WAIT_MS = 15_000;

interface LeaseResponse {
  acquired?: boolean;
  leaseId?: string;
  retryAfterMs?: number;
}

function botState(env: Env): DurableObjectStub {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function acquireKrakenPrivateLease(
  env: Env,
  owner = crypto.randomUUID(),
  now = Date.now(),
): Promise<string> {
  const deadline = now + KRAKEN_PRIVATE_LEASE_WAIT_MS;
  const stub = botState(env);

  while (Date.now() <= deadline) {
    const response = await stub.fetch(`https://bot${KRAKEN_PRIVATE_LEASE_ACQUIRE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner }),
    });
    const body = await response.json().catch(() => ({})) as LeaseResponse;
    if (response.ok && body.acquired === true && typeof body.leaseId === "string") return body.leaseId;
    if (response.status !== 423) {
      throw new Error(`No se pudo adquirir la concesión privada Kraken: HTTP ${response.status}`);
    }
    const retryAfterMs = Number.isFinite(body.retryAfterMs)
      ? Math.max(25, Math.min(250, Number(body.retryAfterMs)))
      : 75;
    await wait(retryAfterMs);
  }

  throw new Error("Concesión privada Kraken ocupada; operación bloqueada antes de usar nonce o red");
}

export async function releaseKrakenPrivateLease(env: Env, leaseId: string): Promise<void> {
  const response = await botState(env).fetch(`https://bot${KRAKEN_PRIVATE_LEASE_RELEASE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaseId }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`No se pudo liberar la concesión privada Kraken: HTTP ${response.status}`);
  }
}

export function isLiveExecutorPrivatePath(pathname: string): boolean {
  return ["/preflight", "/submit", "/reconcile", "/retry", "/emergency-cancel-all"].includes(pathname);
}
