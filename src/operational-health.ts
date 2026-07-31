import type { BotSnapshot } from "./types";

export type OperationalStatus = "healthy" | "degraded" | "stale" | "paused" | "initializing";

export interface OperationalHealth {
  status: OperationalStatus;
  cronHealthy: boolean;
  marketDataFresh: boolean;
  errorRateAccepted: boolean;
  lastAttemptAgeSeconds: number | null;
  lastSuccessfulTickAgeSeconds: number | null;
  lastClosedCandleAgeSeconds: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  expectedCronMinutes: number;
  staleAfterMinutes: number;
  dataStaleAfterMinutes: number;
  liveTrading: false;
  message: string;
}

const EXPECTED_CRON_MINUTES = 5;
const STALE_AFTER_MINUTES = 12;
const DATA_STALE_AFTER_MINUTES = 45;
const MAX_ERROR_RATE_PCT = 1;

function ageSeconds(timestampMs: number | null, now: number): number | null {
  if (timestampMs === null) return null;
  return Math.max(0, Math.floor((now - timestampMs) / 1000));
}

export function calculateOperationalHealth(
  snapshot: BotSnapshot,
  now = Date.now(),
): OperationalHealth {
  const lastAttemptAgeSeconds = ageSeconds(snapshot.lastTickAt, now);
  const lastSuccessfulTickAgeSeconds = ageSeconds(snapshot.lastSuccessfulTickAt, now);
  const lastClosedCandleAgeSeconds = snapshot.lastClosedCandleTime === null
    ? null
    : Math.max(0, Math.floor((now - snapshot.lastClosedCandleTime * 1000) / 1000));
  const totalAttempts = snapshot.ticksObserved + snapshot.errorsObserved;
  const errorRatePct = totalAttempts > 0 ? (snapshot.errorsObserved / totalAttempts) * 100 : 0;
  const cronHealthy = lastSuccessfulTickAgeSeconds !== null
    && lastSuccessfulTickAgeSeconds <= STALE_AFTER_MINUTES * 60;
  const marketDataFresh = lastClosedCandleAgeSeconds !== null
    && lastClosedCandleAgeSeconds <= DATA_STALE_AFTER_MINUTES * 60;
  const errorRateAccepted = errorRatePct <= MAX_ERROR_RATE_PCT && snapshot.consecutiveErrors < 3;

  let status: OperationalStatus;
  let message: string;
  if (snapshot.paused) {
    status = "paused";
    message = "El motor está pausado de forma explícita.";
  } else if (snapshot.lastSuccessfulTickAt === null) {
    status = "initializing";
    message = "El motor espera su primer ciclo correcto.";
  } else if (!cronHealthy) {
    status = "stale";
    message = "No se registra un ciclo correcto dentro del margen esperado del cron.";
  } else if (!marketDataFresh || !errorRateAccepted) {
    status = "degraded";
    message = !marketDataFresh
      ? "El cron responde, pero la última vela cerrada está atrasada."
      : "El motor funciona, pero la tasa o secuencia de errores supera la política.";
  } else {
    status = "healthy";
    message = "Cron, datos de mercado y ejecución PAPER funcionan dentro de los márgenes.";
  }

  return {
    status,
    cronHealthy,
    marketDataFresh,
    errorRateAccepted,
    lastAttemptAgeSeconds,
    lastSuccessfulTickAgeSeconds,
    lastClosedCandleAgeSeconds,
    consecutiveErrors: snapshot.consecutiveErrors,
    lastError: snapshot.lastError,
    expectedCronMinutes: EXPECTED_CRON_MINUTES,
    staleAfterMinutes: STALE_AFTER_MINUTES,
    dataStaleAfterMinutes: DATA_STALE_AFTER_MINUTES,
    liveTrading: false,
    message,
  };
}
