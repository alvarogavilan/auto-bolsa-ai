/**
 * Verificador de aciertos del Radar Mundial.
 *
 * Cada ~hora se guarda el tono del radar por tema junto al precio real de
 * Kraken. Pasado un horizonte (4 h y 24 h) se comprueba si el precio se movió
 * en la dirección que indicaba el tono. Así el radar se gana (o no) el derecho
 * a influir en las órdenes con datos propios, no con fe.
 */
export const RADAR_TRACK_KEY = "radar-track-record:v1";
export const RADAR_SNAPSHOT_MIN_INTERVAL_MS = 30 * 60_000;
export const RADAR_MIN_SAMPLE = 30;
const MAX_SNAPSHOTS = 24 * 45;
const SIGNAL_TONE = 12;
const SIGNAL_MIN_MENTIONS = 3;

export type TrackedTopic = "gold" | "bitcoin" | "ethereum";
export const TRACKED: Array<{ topic: TrackedTopic; label: string; pair: string }> = [
  { topic: "gold", label: "Oro", pair: "PAXGEUR" },
  { topic: "bitcoin", label: "Bitcoin", pair: "XBTEUR" },
  { topic: "ethereum", label: "Ethereum", pair: "ETHEUR" },
];

export interface RadarSnapshot {
  at: number;
  topics: Partial<Record<TrackedTopic, { tone: number; mentions: number; priceEur: number }>>;
}

export interface RadarTrackState {
  schemaVersion: "radar-track-v1";
  snapshots: RadarSnapshot[];
}

export function emptyRadarTrack(): RadarTrackState {
  return { schemaVersion: "radar-track-v1", snapshots: [] };
}

export function parseRadarTrack(raw: unknown): RadarTrackState {
  const value = raw as Partial<RadarTrackState> | null | undefined;
  if (!value || value.schemaVersion !== "radar-track-v1" || !Array.isArray(value.snapshots)) return emptyRadarTrack();
  return { schemaVersion: "radar-track-v1", snapshots: [...value.snapshots] };
}

/** Añade la muestra salvo que la anterior sea demasiado reciente. */
export function recordRadarSnapshot(state: RadarTrackState, snapshot: RadarSnapshot): boolean {
  const last = state.snapshots.at(-1);
  if (last && snapshot.at - last.at < RADAR_SNAPSHOT_MIN_INTERVAL_MS) return false;
  if (Object.keys(snapshot.topics).length === 0) return false;
  state.snapshots = [...state.snapshots, snapshot].slice(-MAX_SNAPSHOTS);
  return true;
}

export interface RadarTrackResult {
  topic: TrackedTopic;
  label: string;
  horizonHours: number;
  signals: number;
  hits: number;
  hitRatePct: number | null;
  averageMoveInSignalDirectionPct: number | null;
  verdict: "Sin muestra suficiente" | "Acierta más que el azar" | "No mejor que el azar" | "Suele fallar";
  explanation: string;
}

export interface RadarTrackReport {
  schemaVersion: "radar-track-report-v1";
  generatedAt: number;
  snapshots: number;
  firstSnapshotAt: number | null;
  minimumSample: number;
  results: RadarTrackResult[];
  mayInfluenceOrders: false;
  note: string;
}

function futureSnapshot(snapshots: RadarSnapshot[], index: number, horizonMs: number): RadarSnapshot | null {
  const origin = snapshots[index] as RadarSnapshot;
  const target = origin.at + horizonMs;
  for (let cursor = index + 1; cursor < snapshots.length; cursor += 1) {
    const candidate = snapshots[cursor] as RadarSnapshot;
    if (candidate.at < target) continue;
    return candidate.at <= target + Math.max(90 * 60_000, horizonMs * 0.25) ? candidate : null;
  }
  return null;
}

export function evaluateRadarTrack(state: RadarTrackState, now: number, horizons = [4, 24]): RadarTrackReport {
  const snapshots = state.snapshots;
  const results: RadarTrackResult[] = [];
  for (const { topic, label } of TRACKED) {
    for (const horizonHours of horizons) {
      let signals = 0;
      let hits = 0;
      let moveSum = 0;
      snapshots.forEach((snapshot, index) => {
        const origin = snapshot.topics[topic];
        if (!origin || Math.abs(origin.tone) < SIGNAL_TONE || origin.mentions < SIGNAL_MIN_MENTIONS || !(origin.priceEur > 0)) return;
        const later = futureSnapshot(snapshots, index, horizonHours * 3_600_000)?.topics[topic];
        if (!later || !(later.priceEur > 0)) return;
        const movePct = ((later.priceEur - origin.priceEur) / origin.priceEur) * 100;
        const directed = origin.tone > 0 ? movePct : -movePct;
        signals += 1;
        moveSum += directed;
        if (directed > 0) hits += 1;
      });
      const hitRatePct = signals > 0 ? Math.round((hits / signals) * 1000) / 10 : null;
      const enough = signals >= RADAR_MIN_SAMPLE;
      const verdict: RadarTrackResult["verdict"] = !enough || hitRatePct === null
        ? "Sin muestra suficiente"
        : hitRatePct >= 58 ? "Acierta más que el azar" : hitRatePct <= 42 ? "Suele fallar" : "No mejor que el azar";
      results.push({
        topic,
        label,
        horizonHours,
        signals,
        hits,
        hitRatePct,
        averageMoveInSignalDirectionPct: signals > 0 ? Math.round((moveSum / signals) * 1000) / 1000 : null,
        verdict,
        explanation: enough
          ? `De ${signals} veces que el radar dio señal en ${label}, el precio le dio la razón ${hits} (${hitRatePct} %) a ${horizonHours} h.`
          : `Faltan datos: ${signals} de ${RADAR_MIN_SAMPLE} señales comprobadas a ${horizonHours} h.`,
      });
    }
  }
  return {
    schemaVersion: "radar-track-report-v1",
    generatedAt: now,
    snapshots: snapshots.length,
    firstSnapshotAt: snapshots[0]?.at ?? null,
    minimumSample: RADAR_MIN_SAMPLE,
    results,
    mayInfluenceOrders: false,
    note: "El radar solo podrá influir en las órdenes si demuestra aquí, con muestra suficiente, que acierta más que el azar. Hoy no influye.",
  };
}
