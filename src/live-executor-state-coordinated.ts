import { DurableObject } from "cloudflare:workers";
import { LiveExecutorState as BaseLiveExecutorState } from "./live-executor-state";
import {
  acquireKrakenPrivateLease,
  isLiveExecutorPrivatePath,
  releaseKrakenPrivateLease,
} from "./kraken-private-lease";
import type { Env } from "./types";

/**
 * Adaptador de seguridad del Durable Object LIVE. Conserva exactamente la
 * máquina de estados existente, pero cualquier ruta que pueda usar la API
 * privada de Kraken debe poseer antes la concesión global guardada en BotState.
 */
export class CoordinatedLiveExecutorState extends DurableObject<Env> {
  private readonly delegate: BaseLiveExecutorState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.delegate = new BaseLiveExecutorState(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!isLiveExecutorPrivatePath(pathname)) return this.delegate.fetch(request);

    let leaseId: string;
    try {
      leaseId = await acquireKrakenPrivateLease(this.env, `live-executor:${crypto.randomUUID()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Concesión privada Kraken no disponible";
      return Response.json(
        {
          error: "KRAKEN_PRIVATE_CALL_BUSY",
          message,
          retryableAfterReconciliation: true,
          liveTrading: false,
        },
        { status: 423, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      return await this.delegate.fetch(request);
    } finally {
      await releaseKrakenPrivateLease(this.env, leaseId).catch(() => undefined);
    }
  }
}
