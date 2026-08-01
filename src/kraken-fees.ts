import { normalizeCredential, signKrakenRequest } from "./kraken";

const TRADE_VOLUME_PATH = "/0/private/TradeVolume";
const TRADE_VOLUME_URL = "https://api.kraken.com/0/private/TradeVolume";
const KNOWN_QUOTES = ["USDT", "USDC", "EUR", "USD", "GBP", "CAD", "JPY", "AUD", "CHF"] as const;

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

export interface KrakenEffectiveFeesAudit {
  schemaVersion: "kraken-effective-fees-v1";
  checkedAt: number;
  pairRequested: string;
  currency: string | null;
  volume30d: number | null;
  maker: KrakenEffectiveFeeRate | null;
  taker: KrakenEffectiveFeeRate | null;
  assumedPaperFeeEachSidePct: number;
  paperFeeMatchesCurrentTaker: boolean | null;
  recommendedPaperFeeEachSideRate: number | null;
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
  inputs?: { domain_spot_volume_30d?: unknown };
  fees?: Record<string, RawFee>;
  fees_maker?: Record<string, RawFee>;
};

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactPair(value: string): string {
  return value.toUpperCase().replace(/[\s/_-]/g, "");
}

/**
 * Convierte aliases habituales de Kraken a una forma comparable sin asumir
 * que la primera tarifa devuelta pertenece al par solicitado.
 * Ejemplo: XXBTZEUR, XBT/EUR y XBTEUR se comparan como XBTEUR.
 */
export function canonicalKrakenFeePair(value: string): string {
  const compact = compactPair(value);
  for (const quote of KNOWN_QUOTES) {
    const quoteAliases = [`Z${quote}`, quote];
    for (const quoteAlias of quoteAliases) {
      if (!compact.endsWith(quoteAlias) || compact.length <= quoteAlias.length) continue;
      let base = compact.slice(0, -quoteAlias.length);
      if (base.length > 3 && (base.startsWith("X") || base.startsWith("Z"))) base = base.slice(1);
      return `${base}${quote}`;
    }
  }
  return compact;
}

function feeFromMap(
  map: Record<string, RawFee> | undefined,
  requestedPair: string,
): KrakenEffectiveFeeRate | null {
  if (!map || typeof map !== "object") return null;
  const requestedCanonical = canonicalKrakenFeePair(requestedPair);
  const match = Object.entries(map).find(([pair]) => canonicalKrakenFeePair(pair) === requestedCanonical);
  if (!match) return null;
  const [actualPair, raw] = match;
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

function parsePayload(value: unknown): RawTradeVolumeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kraken TradeVolume returned invalid JSON");
  }
  const payload = value as { error?: unknown; result?: unknown };
  const errors = Array.isArray(payload.error)
    ? payload.error.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (errors.length > 0) throw new Error(`Kraken TradeVolume: ${errors.join(", ")}`);
  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("Kraken TradeVolume result is missing");
  }
  return payload.result as RawTradeVolumeResult;
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
  if (!Number.isFinite(assumedPaperFeeEachSideRate) || assumedPaperFeeEachSideRate < 0) {
    throw new Error("Invalid PAPER fee assumption");
  }

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
  const result = parsePayload(await response.json());
  const taker = feeFromMap(result.fees, normalizedPair);
  const maker = feeFromMap(result.fees_maker, normalizedPair);
  const volume30d = finiteOrNull(result.inputs?.domain_spot_volume_30d) ?? finiteOrNull(result.volume);
  const assumedPercent = assumedPaperFeeEachSideRate * 100;
  const matches = taker === null ? null : Math.abs(taker.percent - assumedPercent) <= 0.000001;

  return {
    schemaVersion: "kraken-effective-fees-v1",
    checkedAt: now,
    pairRequested: normalizedPair,
    currency: typeof result.currency === "string" ? result.currency : null,
    volume30d,
    maker,
    taker,
    assumedPaperFeeEachSidePct: assumedPercent,
    paperFeeMatchesCurrentTaker: matches,
    recommendedPaperFeeEachSideRate: taker?.rate ?? null,
    networkCallToKraken: true,
    readOnly: true,
    realOrderCreated: false,
    liveTrading: false,
  };
}
