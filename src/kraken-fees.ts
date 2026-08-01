import { normalizeCredential, signKrakenRequest } from "./kraken";

const TRADE_VOLUME_PATH = "/0/private/TradeVolume";
const TRADE_VOLUME_URL = "https://api.kraken.com/0/private/TradeVolume";

export interface KrakenEffectiveFeeRate {
  pair: string;
  percent: number;
  rate: number;
  minPercent: number | null;
  maxPercent: number | null;
  nextPercent: number | null;
  tierVolume: number | null;
  nextVolume: number | null;
}

export interface KrakenFeeTierInputs {
  spotVolume30d: number | null;
  futuresVolume30d: number | null;
  assetsOnPlatform: number | null;
  effectiveTierBasis: number | null;
  effectiveTierBasisSource: "spot-volume" | "futures-volume" | "assets-on-platform" | "unknown";
}

export interface KrakenEffectiveFeesAudit {
  schemaVersion: "kraken-effective-fees-v1";
  checkedAt: number;
  pairRequested: string;
  pairResolved: string | null;
  currency: string | null;
  volume30d: number | null;
  tierInputs: KrakenFeeTierInputs;
  maker: KrakenEffectiveFeeRate | null;
  taker: KrakenEffectiveFeeRate | null;
  assumedPaperFeeEachSidePct: number;
  paperFeeMatchesCurrentTaker: boolean | null;
  paperTakerGapRate: number | null;
  recommendedPaperFeeEachSideRate: number | null;
  fiveEurTakerRoundTripFeeEur: number | null;
  changesStrategyParameters: false;
  networkCallToKraken: true;
  readOnly: true;
  realOrderCreated: false;
  liveTrading: false;
}

type RawFee = {
  fee?: unknown;
  minfee?: unknown;
  maxfee?: unknown;
  nextfee?: unknown;
  tiervolume?: unknown;
  nextvolume?: unknown;
};

type RawTradeVolumeResult = {
  currency?: unknown;
  volume?: unknown;
  inputs?: {
    domain_spot_volume_30d?: unknown;
    domain_futures_volume_30d?: unknown;
    domain_assets_on_platform?: unknown;
  };
  fees?: Record<string, RawFee>;
  fees_maker?: Record<string, RawFee>;
};

export type KrakenTradeVolumePayload = {
  error?: unknown;
  result?: unknown;
};

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalPair(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^XXBT/, "XBT")
    .replace(/^XBTC/, "XBT")
    .replace(/ZEUR$/, "EUR")
    .replace(/ZUSD$/, "USD")
    .replace(/ZGBP$/, "GBP")
    .replace(/ZCAD$/, "CAD")
    .replace(/ZJPY$/, "JPY");
}

function matchingPairKey(map: Record<string, RawFee>, requestedPair: string): string | null {
  if (map[requestedPair]) return requestedPair;
  const requestedCanonical = canonicalPair(requestedPair);
  const canonicalMatches = Object.keys(map).filter((pair) => canonicalPair(pair) === requestedCanonical);
  if (canonicalMatches.length === 1) return canonicalMatches[0] ?? null;
  const keys = Object.keys(map);
  // TradeVolume is called with exactly one requested pair. Accepting the sole
  // returned key is safe, while refusing an ambiguous multi-pair response.
  return keys.length === 1 ? keys[0] ?? null : null;
}

function feeFromMap(
  map: Record<string, RawFee> | undefined,
  requestedPair: string,
): KrakenEffectiveFeeRate | null {
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const actualPair = matchingPairKey(map, requestedPair);
  if (!actualPair) return null;
  const raw = map[actualPair];
  if (!raw || typeof raw !== "object") return null;
  const percent = finiteOrNull(raw.fee);
  if (percent === null || percent < 0) return null;
  return {
    pair: actualPair,
    percent,
    rate: percent / 100,
    minPercent: finiteOrNull(raw.minfee),
    maxPercent: finiteOrNull(raw.maxfee),
    nextPercent: finiteOrNull(raw.nextfee),
    tierVolume: finiteOrNull(raw.tiervolume),
    nextVolume: finiteOrNull(raw.nextvolume),
  };
}

export function parseKrakenTradeVolumePayload(value: unknown): RawTradeVolumeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kraken TradeVolume returned invalid JSON");
  }
  const payload = value as KrakenTradeVolumePayload;
  const errors = Array.isArray(payload.error)
    ? payload.error.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (errors.length > 0) throw new Error(`Kraken TradeVolume: ${errors.join(", ")}`);
  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("Kraken TradeVolume result is missing");
  }
  return payload.result as RawTradeVolumeResult;
}

function tierInputs(result: RawTradeVolumeResult): KrakenFeeTierInputs {
  const spotVolume30d = finiteOrNull(result.inputs?.domain_spot_volume_30d);
  const futuresVolume30d = finiteOrNull(result.inputs?.domain_futures_volume_30d);
  const assetsOnPlatform = finiteOrNull(result.inputs?.domain_assets_on_platform);
  const candidates = [
    { source: "spot-volume" as const, value: spotVolume30d },
    { source: "futures-volume" as const, value: futuresVolume30d },
    { source: "assets-on-platform" as const, value: assetsOnPlatform },
  ].filter((item): item is { source: KrakenFeeTierInputs["effectiveTierBasisSource"]; value: number } =>
    typeof item.value === "number" && Number.isFinite(item.value),
  );
  const best = candidates.sort((left, right) => right.value - left.value)[0] ?? null;
  return {
    spotVolume30d,
    futuresVolume30d,
    assetsOnPlatform,
    effectiveTierBasis: best?.value ?? null,
    effectiveTierBasisSource: best?.source ?? "unknown",
  };
}

export function buildKrakenEffectiveFeesAudit(
  payload: unknown,
  pair: string,
  assumedPaperFeeEachSideRate: number,
  now = Date.now(),
): KrakenEffectiveFeesAudit {
  const normalizedPair = pair.trim();
  if (!normalizedPair) throw new Error("Kraken fee pair is empty");
  if (!Number.isFinite(assumedPaperFeeEachSideRate) || assumedPaperFeeEachSideRate < 0) {
    throw new Error("Invalid PAPER fee assumption");
  }
  const result = parseKrakenTradeVolumePayload(payload);
  const taker = feeFromMap(result.fees, normalizedPair);
  const maker = feeFromMap(result.fees_maker, normalizedPair);
  if (!taker && !maker) {
    throw new Error(`Kraken TradeVolume returned no unambiguous fee tier for ${normalizedPair}`);
  }
  const inputs = tierInputs(result);
  const volume30d = inputs.spotVolume30d ?? finiteOrNull(result.volume);
  const assumedPercent = assumedPaperFeeEachSideRate * 100;
  const matches = taker === null ? null : Math.abs(taker.percent - assumedPercent) <= 0.000001;
  const paperTakerGapRate = taker === null ? null : taker.rate - assumedPaperFeeEachSideRate;

  return {
    schemaVersion: "kraken-effective-fees-v1",
    checkedAt: now,
    pairRequested: normalizedPair,
    pairResolved: taker?.pair ?? maker?.pair ?? null,
    currency: typeof result.currency === "string" ? result.currency : null,
    volume30d,
    tierInputs: inputs,
    maker,
    taker,
    assumedPaperFeeEachSidePct: assumedPercent,
    paperFeeMatchesCurrentTaker: matches,
    paperTakerGapRate,
    recommendedPaperFeeEachSideRate: taker?.rate ?? null,
    fiveEurTakerRoundTripFeeEur: taker ? 5 * taker.rate * 2 : null,
    changesStrategyParameters: false,
    networkCallToKraken: true,
    readOnly: true,
    realOrderCreated: false,
    liveTrading: false,
  };
}

export async function fetchKrakenEffectiveFees(
  apiKey: string,
  apiSecret: string,
  nonce: string,
  pair: string,
  assumedPaperFeeEachSideRate: number,
  now = Date.now(),
): Promise<KrakenEffectiveFeesAudit> {
  const normalizedKey = normalizeCredential(apiKey);
  const normalizedSecret = normalizeCredential(apiSecret);
  const normalizedPair = pair.trim();
  if (!normalizedKey || !normalizedSecret) throw new Error("Kraken credentials are empty after normalization");
  if (!normalizedPair) throw new Error("Kraken fee pair is empty");

  const postData = new URLSearchParams({
    nonce,
    pair: normalizedPair,
    "fee-info": "true",
    fee_schedule: "true",
  }).toString();
  const signature = await signKrakenRequest(TRADE_VOLUME_PATH, nonce, postData, normalizedSecret);
  const response = await fetch(TRADE_VOLUME_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "API-Key": normalizedKey,
      "API-Sign": signature,
      "User-Agent": "auto-bolsa-ai/fee-audit-v1",
    },
    body: postData,
  });
  if (!response.ok) throw new Error(`Kraken TradeVolume HTTP ${response.status}`);
  return buildKrakenEffectiveFeesAudit(
    await response.json(),
    normalizedPair,
    assumedPaperFeeEachSideRate,
    now,
  );
}
