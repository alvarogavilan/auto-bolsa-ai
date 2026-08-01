export interface NewsSource {
  id: string;
  label: string;
  url: string;
  authority: "central-bank" | "regulator" | "exchange";
  defaultAssets: string[];
}

export interface NewsSignal {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  link: string | null;
  publishedAt: number | null;
  detectedAt: number;
  impactScore: number;
  confidence: number;
  direction: "risk-on" | "risk-off" | "mixed" | "neutral";
  assets: string[];
  reasons: string[];
}

export interface NewsIntelligenceReport {
  schemaVersion: "global-news-intelligence-v1";
  generatedAt: number;
  refreshTargetSeconds: 60;
  sourcesConfigured: number;
  sourcesAvailable: number;
  signals: NewsSignal[];
  sourceStatus: Array<{
    id: string;
    label: string;
    available: boolean;
    items: number;
    error: string | null;
  }>;
  changesTradingDecision: false;
  advisoryOnly: true;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export const OFFICIAL_NEWS_SOURCES: NewsSource[] = [
  {
    id: "federal-reserve",
    label: "Reserva Federal de EE. UU.",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    authority: "central-bank",
    defaultAssets: ["BTC", "ETH", "XAUT", "EUR", "USD"],
  },
  {
    id: "ecb",
    label: "Banco Central Europeo",
    url: "https://www.ecb.europa.eu/rss/press.html",
    authority: "central-bank",
    defaultAssets: ["EUR", "BTC", "ETH", "XAUT"],
  },
  {
    id: "sec",
    label: "SEC de EE. UU.",
    url: "https://www.sec.gov/news/pressreleases.rss",
    authority: "regulator",
    defaultAssets: ["BTC", "ETH", "CRYPTO"],
  },
];

const HIGH_IMPACT = [
  "interest rate", "rates", "inflation", "monetary policy", "fomc", "emergency",
  "sanction", "war", "default", "liquidity", "bank failure", "etf", "enforcement",
  "hack", "exploit", "suspension", "approval", "rejection", "tariff",
];
const RISK_OFF = [
  "rate increase", "higher rates", "inflation", "sanction", "war", "default",
  "enforcement", "rejection", "hack", "exploit", "failure", "liquidity stress",
];
const RISK_ON = [
  "rate cut", "lower rates", "approval", "stimulus", "liquidity support", "easing",
];

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decode(match[1] ?? "") : null;
}

function atomLink(block: string): string | null {
  const match = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ?? tag(block, "link");
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classify(source: NewsSource, title: string, link: string | null, publishedAt: number | null, now: number): NewsSignal {
  const lower = title.toLowerCase();
  const highMatches = HIGH_IMPACT.filter((term) => lower.includes(term));
  const offMatches = RISK_OFF.filter((term) => lower.includes(term));
  const onMatches = RISK_ON.filter((term) => lower.includes(term));
  const direction = offMatches.length > onMatches.length
    ? "risk-off"
    : onMatches.length > offMatches.length ? "risk-on" : highMatches.length > 0 ? "mixed" : "neutral";
  const authorityWeight = source.authority === "central-bank" ? 22 : source.authority === "regulator" ? 18 : 14;
  const impactScore = Math.min(100, 12 + authorityWeight + highMatches.length * 14);
  const confidence = Math.min(0.98, 0.58 + authorityWeight / 100 + Math.min(0.18, highMatches.length * 0.04));
  const assets = new Set(source.defaultAssets);
  if (/gold|xaut|precious metal/.test(lower)) assets.add("XAUT");
  if (/bitcoin|btc|crypto|digital asset/.test(lower)) assets.add("BTC");
  if (/ethereum|ether|eth/.test(lower)) assets.add("ETH");
  if (/euro|ecb/.test(lower)) assets.add("EUR");
  if (/dollar|federal reserve|fomc/.test(lower)) assets.add("USD");
  const id = `${source.id}:${publishedAt ?? 0}:${title}`;
  return {
    id,
    sourceId: source.id,
    source: source.label,
    title,
    link,
    publishedAt,
    detectedAt: now,
    impactScore,
    confidence,
    direction,
    assets: [...assets],
    reasons: highMatches.length > 0
      ? highMatches.map((term) => `Coincidencia de impacto: ${term}`)
      : ["Fuente oficial sin término de impacto elevado detectado"],
  };
}

function parseFeed(source: NewsSource, xml: string, now: number): NewsSignal[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1] ?? "");
  return blocks.slice(0, 20).flatMap((block) => {
    const title = tag(block, "title");
    if (!title) return [];
    const publishedAt = parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated"));
    return [classify(source, title, atomLink(block), publishedAt, now)];
  });
}

async function fetchSource(source: NewsSource, now: number): Promise<{
  signals: NewsSignal[];
  status: NewsIntelligenceReport["sourceStatus"][number];
}> {
  try {
    const response = await fetch(source.url, {
      headers: {
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
        "User-Agent": "Auto-Bolsa-AI/1.0 research-only",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const signals = parseFeed(source, await response.text(), now);
    return {
      signals,
      status: { id: source.id, label: source.label, available: true, items: signals.length, error: null },
    };
  } catch (error) {
    return {
      signals: [],
      status: {
        id: source.id,
        label: source.label,
        available: false,
        items: 0,
        error: error instanceof Error ? error.message : "NEWS_SOURCE_FAILED",
      },
    };
  }
}

export async function buildNewsIntelligence(now = Date.now()): Promise<NewsIntelligenceReport> {
  const results = await Promise.all(OFFICIAL_NEWS_SOURCES.map((source) => fetchSource(source, now)));
  const signals = results
    .flatMap((result) => result.signals)
    .sort((left, right) =>
      right.impactScore - left.impactScore
      || (right.publishedAt ?? 0) - (left.publishedAt ?? 0),
    )
    .slice(0, 40);
  return {
    schemaVersion: "global-news-intelligence-v1",
    generatedAt: now,
    refreshTargetSeconds: 60,
    sourcesConfigured: OFFICIAL_NEWS_SOURCES.length,
    sourcesAvailable: results.filter((result) => result.status.available).length,
    signals,
    sourceStatus: results.map((result) => result.status),
    changesTradingDecision: false,
    advisoryOnly: true,
    eligibleForLiveReview: false,
    liveTrading: false,
  };
}
