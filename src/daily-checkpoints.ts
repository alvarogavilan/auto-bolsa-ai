import { calculateOperationalHealth } from "./operational-health";
import type { BotSnapshot, PaperPerformance } from "./types";

const encoder = new TextEncoder();

export interface PaperCheckpointMetrics {
  equityEur: number;
  cashEur: number;
  positionOpen: boolean;
  lastPrice: number | null;
  ticksObserved: number;
  uniqueClosedCandlesObserved: number;
  duplicateCandleSkips: number;
  errorsObserved: number;
  consecutiveErrors: number;
  maxObservedDrawdownPct: number;
  lastSuccessfulTickAt: number | null;
  operationalStatus: "healthy" | "degraded" | "stale" | "paused" | "initializing";
  performance: PaperPerformance;
}

export interface PaperDailyCheckpoint {
  schemaVersion: "paper-daily-checkpoint-v1";
  sequence: number;
  dayKey: string;
  recordedAt: number;
  previousHash: string | null;
  metrics: PaperCheckpointMetrics;
  hash: string;
}

export interface CheckpointChainVerification {
  valid: boolean;
  checked: number;
  anchoredAtSequence: number | null;
  anchorPreviousHash: string | null;
  brokenAtSequence: number | null;
  latestHash: string | null;
}

type CheckpointPayload = Omit<PaperDailyCheckpoint, "hash">;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPayload(payload: CheckpointPayload): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(payload))),
  );
  return bytesToHex(digest);
}

function payloadOf(checkpoint: PaperDailyCheckpoint): CheckpointPayload {
  return {
    schemaVersion: checkpoint.schemaVersion,
    sequence: checkpoint.sequence,
    dayKey: checkpoint.dayKey,
    recordedAt: checkpoint.recordedAt,
    previousHash: checkpoint.previousHash,
    metrics: checkpoint.metrics,
  };
}

export async function createDailyCheckpoint(
  snapshot: BotSnapshot,
  previous: PaperDailyCheckpoint | null,
  recordedAt = Date.now(),
): Promise<PaperDailyCheckpoint> {
  const operationalHealth = calculateOperationalHealth(snapshot, recordedAt);
  const payload: CheckpointPayload = {
    schemaVersion: "paper-daily-checkpoint-v1",
    sequence: (previous?.sequence ?? 0) + 1,
    dayKey: snapshot.dayKey,
    recordedAt,
    previousHash: previous?.hash ?? null,
    metrics: {
      equityEur: snapshot.equityEur,
      cashEur: snapshot.cashEur,
      positionOpen: snapshot.position !== null,
      lastPrice: snapshot.lastPrice,
      ticksObserved: snapshot.ticksObserved,
      uniqueClosedCandlesObserved: snapshot.uniqueClosedCandlesObserved,
      duplicateCandleSkips: snapshot.duplicateCandleSkips,
      errorsObserved: snapshot.errorsObserved,
      consecutiveErrors: snapshot.consecutiveErrors,
      maxObservedDrawdownPct: snapshot.maxObservedDrawdownPct,
      lastSuccessfulTickAt: snapshot.lastSuccessfulTickAt,
      operationalStatus: operationalHealth.status,
      performance: { ...snapshot.performance },
    },
  };

  return { ...payload, hash: await hashPayload(payload) };
}

export async function verifyCheckpointChain(
  checkpoints: PaperDailyCheckpoint[],
): Promise<CheckpointChainVerification> {
  const first = checkpoints[0] ?? null;
  const anchoredAtSequence = first?.sequence ?? null;
  const anchorPreviousHash = first?.previousHash ?? null;
  let previousHash = anchorPreviousHash;
  let expectedSequence = anchoredAtSequence ?? 1;
  let checked = 0;

  for (const checkpoint of checkpoints) {
    const expectedHash = await hashPayload(payloadOf(checkpoint));
    const valid = checkpoint.schemaVersion === "paper-daily-checkpoint-v1"
      && checkpoint.sequence === expectedSequence
      && checkpoint.previousHash === previousHash
      && checkpoint.hash === expectedHash;

    if (!valid) {
      return {
        valid: false,
        checked,
        anchoredAtSequence,
        anchorPreviousHash,
        brokenAtSequence: checkpoint.sequence,
        latestHash: previousHash,
      };
    }

    previousHash = checkpoint.hash;
    expectedSequence += 1;
    checked += 1;
  }

  return {
    valid: true,
    checked,
    anchoredAtSequence,
    anchorPreviousHash,
    brokenAtSequence: null,
    latestHash: previousHash,
  };
}
