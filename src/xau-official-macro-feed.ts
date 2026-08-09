import type { XauMacroEvidence, XauBias } from "./xau-usd-specialist-cabinet";

interface FredObservation {
  observedAt: number;
  value: number;
}

interface FredSeriesSpec {
  id: string;
  maxAgeDays: number;
  lag: number;
}

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";
const DAY_MS = 24 * 60 * 60 * 1_000;

const SERIES = {
  broadDollar: { id: "DTWEXBGS", maxAgeDays: 10, lag: 5 },
  realYield10y: { id: "DFII10", maxAgeDays: 7, lag: 5 },
  fedFunds: { id: "DFF", maxAgeDays: 7, lag: 20 },
  cpi: { id: "CPIAUCSL", maxAgeDays: 45, lag: 1 },
} satisfies Record<string, FredSeriesSpec>;

function numeric(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFredCsv(text: string): FredObservation[] {
  const lines = text.trim().split(/\r?\n/).slice(1);
  const rows: FredObservation[] = [];
  for (const line of lines) {
    const comma = line.indexOf(",");
    if (comma <= 0) continue;
    const dateText = line.slice(0, comma).trim();
    const value = numeric(line.slice(comma + 1));
    const observedAt = Date.parse(`${dateText}T00:00:00Z`);
    if (value === null || !Number.isFinite(observedAt)) continue;
    rows.push({ observedAt, value });
  }
  return rows.sort((left, right) => left.observedAt - right.observedAt);
}

async function fetchFredSeries(spec: FredSeriesSpec): Promise<FredObservation[]> {
  const response = await fetch(`${FRED_BASE}${encodeURIComponent(spec.id)}`, {
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) throw new Error(`FRED ${spec.id} HTTP ${response.status}`);
  const rows = parseFredCsv(await response.text());
  if (rows.length < spec.lag + 1) throw new Error(`FRED ${spec.id} insufficient history`);
  return rows;
}

function isFresh(rows: FredObservation[], spec: FredSeriesSpec, now: number): boolean {
  const latest = rows.at(-1);
  return Boolean(latest && now - latest.observedAt <= spec.maxAgeDays * DAY_MS);
}

function percentChangeBias(rows: FredObservation[], lag: number, inverseForGold: boolean, deadbandPct: number): XauBias {
  const latest = rows.at(-1);
  const previous = rows.at(-(lag + 1));
  if (!latest || !previous || previous.value === 0) return "neutral";
  const changePct = ((latest.value - previous.value) / Math.abs(previous.value)) * 100;
  if (Math.abs(changePct) <= deadbandPct) return "neutral";
  const rising: XauBias = inverseForGold ? "short" : "long";
  const falling: XauBias = inverseForGold ? "long" : "short";
  return changePct > 0 ? rising : falling;
}

function absoluteChangeBias(rows: FredObservation[], lag: number, inverseForGold: boolean, deadband: number): XauBias {
  const latest = rows.at(-1);
  const previous = rows.at(-(lag + 1));
  if (!latest || !previous) return "neutral";
  const change = latest.value - previous.value;
  if (Math.abs(change) <= deadband) return "neutral";
  const rising: XauBias = inverseForGold ? "short" : "long";
  const falling: XauBias = inverseForGold ? "long" : "short";
  return change > 0 ? rising : falling;
}

function neutralMacro(): XauMacroEvidence {
  return {
    dxyBiasForGold: "neutral",
    realYieldsBiasForGold: "neutral",
    centralBankBias: "neutral",
    inflationBias: "neutral",
    geopoliticalBias: "neutral",
    highImpactEventWithinMinutes: null,
    sourcesAvailable: 0,
    sourcesFresh: 0,
  };
}

/**
 * Public, read-only macro evidence from official Federal Reserve/FRED series.
 * Any missing/stale series is fail-soft: it contributes neither freshness nor
 * directional conviction and can never make a blocked PAPER decision permissive.
 */
export async function buildOfficialXauMacroEvidence(now = Date.now()): Promise<XauMacroEvidence> {
  const entries = await Promise.allSettled([
    fetchFredSeries(SERIES.broadDollar),
    fetchFredSeries(SERIES.realYield10y),
    fetchFredSeries(SERIES.fedFunds),
    fetchFredSeries(SERIES.cpi),
  ]);

  const [dollar, realYield, fedFunds, cpi] = entries.map((entry) => entry.status === "fulfilled" ? entry.value : null);
  const sourcesAvailable = [dollar, realYield, fedFunds, cpi].filter(Boolean).length;
  const sourcesFresh = [
    dollar && isFresh(dollar, SERIES.broadDollar, now),
    realYield && isFresh(realYield, SERIES.realYield10y, now),
    fedFunds && isFresh(fedFunds, SERIES.fedFunds, now),
    cpi && isFresh(cpi, SERIES.cpi, now),
  ].filter(Boolean).length;

  if (sourcesAvailable === 0) return neutralMacro();

  return {
    dxyBiasForGold: dollar && isFresh(dollar, SERIES.broadDollar, now)
      ? percentChangeBias(dollar, SERIES.broadDollar.lag, true, 0.08)
      : "neutral",
    realYieldsBiasForGold: realYield && isFresh(realYield, SERIES.realYield10y, now)
      ? absoluteChangeBias(realYield, SERIES.realYield10y.lag, true, 0.03)
      : "neutral",
    centralBankBias: fedFunds && isFresh(fedFunds, SERIES.fedFunds, now)
      ? absoluteChangeBias(fedFunds, SERIES.fedFunds.lag, true, 0.05)
      : "neutral",
    inflationBias: cpi && isFresh(cpi, SERIES.cpi, now)
      ? percentChangeBias(cpi, SERIES.cpi.lag, false, 0.10)
      : "neutral",
    geopoliticalBias: "neutral",
    highImpactEventWithinMinutes: null,
    sourcesAvailable,
    sourcesFresh,
  };
}
