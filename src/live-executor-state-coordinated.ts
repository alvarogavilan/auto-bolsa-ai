import { LiveExecutorState as BaseLiveExecutorState } from "./live-executor-state";
import {
  acquireKrakenPrivateLease,
  isLiveExecutorPrivatePath,
  releaseKrakenPrivateLease,
  startKrakenPrivateLeaseHeartbeat,
} from "./kraken-private-lease";

export class CoordinatedLiveExecutorState extends BaseLiveExecutorState {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!isLiveExecutorPrivatePath(pathname)) return super.fetch(request);

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

    const heartbeat = startKrakenPrivateLeaseHeartbeat(this.env, leaseId);
    try {
      const response = await super.fetch(request);
      const renewalFailure = heartbeat.failure();
      if (renewalFailure) {
        return Response.json(
          {
            error: "KRAKEN_PRIVATE_LEASE_RENEWAL_FAILED",
            message: renewalFailure.message,
            originalStatus: response.status,
            reconciliationRequired: true,
            liveTrading: false,
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      return response;
    } finally {
      heartbeat.stop();
      await releaseKrakenPrivateLease(this.env, leaseId).catch(() => undefined);
    }
  }
}
