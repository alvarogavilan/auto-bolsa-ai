export type NewsAuthority = "central-bank" | "regulator" | "government" | "multilateral" | "cybersecurity" | "exchange";
export type NewsFormat = "feed" | "html";
export type EventTopic = "monetary-policy" | "inflation" | "geopolitics" | "war" | "sanctions" | "political-speech" | "regulation" | "cybersecurity" | "exchange-incident" | "energy" | "shipping" | "etf" | "other";

export interface NewsSource {
  id: string;
  label: string;
  url: string;
  authority: NewsAuthority;
  format: NewsFormat;
  defaultAssets: string[];
  regions: string[];
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
  urgency: "breaking" | "high" | "normal";
  verification: "primary-source" | "corroborated-primary";
  corroboratingSources: number;
  topics: EventTopic[];
  namedEntities: string[];
  assets: string[];
  reasons: string[];
}

export interface NewsIntelligenceReport {
  schemaVersion: "global-news-intelligence-v2";
  generatedAt: number;
  refreshTargetSeconds: 60;
  sourcesConfigured: number;
  sourcesAvailable: number;
  signals: NewsSignal[];
  breakingSignals: number;
  highImpactSignals: number;
  coverage: {
    regions: string[];
    topics: EventTopic[];
    primarySourcesOnly: true;
    impossibleToGuaranteeTotalWorldCoverage: true;
  };
  sourceStatus: Array<{ id: string; label: string; available: boolean; items: number; latencyMs: number; error: string | null }>;
  changesTradingDecision: false;
  advisoryOnly: true;
  eligibleForLiveReview: false;
  liveTrading: false;
}

export const OFFICIAL_NEWS_SOURCES: NewsSource[] = [
  { id: "federal-reserve", label: "Reserva Federal de EE. UU.", url: "https://www.federalreserve.gov/feeds/press_all.xml", authority: "central-bank", format: "feed", defaultAssets: ["BTC", "ETH", "XAUT", "EUR", "USD"], regions: ["US", "GLOBAL"] },
  { id: "ecb", label: "Banco Central Europeo", url: "https://www.ecb.europa.eu/rss/press.html", authority: "central-bank", format: "feed", defaultAssets: ["EUR", "BTC", "ETH", "XAUT"], regions: ["EU", "GLOBAL"] },
  { id: "sec", label: "SEC de EE. UU.", url: "https://www.sec.gov/news/pressreleases.rss", authority: "regulator", format: "feed", defaultAssets: ["BTC", "ETH", "CRYPTO"], regions: ["US", "GLOBAL"] },
  { id: "us-treasury", label: "Tesoro de EE. UU.", url: "https://home.treasury.gov/news/press-releases", authority: "government", format: "html", defaultAssets: ["USD", "XAUT", "BTC", "ETH"], regions: ["US", "GLOBAL"] },
  { id: "white-house-remarks", label: "Discursos y declaraciones de la Casa Blanca", url: "https://www.whitehouse.gov/remarks/", authority: "government", format: "html", defaultAssets: ["USD", "XAUT", "BTC", "ETH", "ENERGY"], regions: ["US", "GLOBAL"] },
  { id: "un-security-council", label: "Consejo de Seguridad de Naciones Unidas", url: "https://press.un.org/en/content/security-council/press-release", authority: "multilateral", format: "html", defaultAssets: ["XAUT", "USD", "EUR", "ENERGY", "BTC"], regions: ["GLOBAL"] },
  { id: "cisa-advisories", label: "CISA · Alertas de ciberseguridad", url: "https://www.cisa.gov/news-events/cybersecurity-advisories", authority: "cybersecurity", format: "html", defaultAssets: ["BTC", "ETH", "CRYPTO", "TECH"], regions: ["US", "GLOBAL"] },
  { id: "cftc", label: "CFTC de EE. UU.", url: "https://www.cftc.gov/PressRoom/PressReleases", authority: "regulator", format: "html", defaultAssets: ["BTC", "ETH", "CRYPTO", "COMMODITIES"], regions: ["US", "GLOBAL"] },
  { id: "bank-of-england", label: "Banco de Inglaterra", url: "https://www.bankofengland.co.uk/news", authority: "central-bank", format: "html", defaultAssets: ["GBP", "EUR", "USD", "XAUT", "BTC"], regions: ["UK", "GLOBAL"] },
  { id: "kraken-status", label: "Estado oficial de Kraken", url: "https://status.kraken.com/history.rss", authority: "exchange", format: "feed", defaultAssets: ["KRAKEN", "BTC", "ETH", "EUR"], regions: ["GLOBAL"] },
];

const TOPIC_TERMS: Record<EventTopic, string[]> = {
  "monetary-policy": ["interest rate", "rates", "monetary policy", "fomc", "central bank", "rate cut", "rate hike"],
  inflation: ["inflation", "cpi", "prices", "pce"],
  geopolitics: ["geopolitical", "conflict", "invasion", "military", "security council"],
  war: ["war", "attack", "missile", "troops", "ceasefire", "airstrike", "hostilities"],
  sanctions: ["sanction", "embargo", "asset freeze", "tariff"],
  "political-speech": ["remarks", "speech", "address", "president", "prime minister", "donald trump", "administration"],
  regulation: ["regulation", "enforcement", "lawsuit", "approval", "rejection", "legislation", "etf"],
  cybersecurity: ["hack", "exploit", "ransomware", "cyber", "breach", "vulnerability"],
  "exchange-incident": ["outage", "degraded", "maintenance", "withdrawal", "deposit", "trading unavailable"],
  energy: ["oil", "gas", "opec", "energy", "pipeline"],
  shipping: ["shipping", "strait", "red sea", "suez", "port", "freight"],
  etf: ["etf", "exchange-traded fund"],
  other: [],
};
const RISK_OFF = ["rate hike", "higher rates", "inflation", "sanction", "war", "attack", "default", "enforcement", "rejection", "hack", "exploit", "failure", "outage", "tariff"];
const RISK_ON = ["rate cut", "lower rates", "approval", "stimulus", "liquidity support", "easing", "ceasefire"];
const ENTITY_PATTERNS: Array<[string, RegExp]> = [
  ["Donald Trump", /donald trump|president trump/i], ["Federal Reserve", /federal reserve|fomc/i], ["ECB", /european central bank|\becb\b/i],
  ["SEC", /securities and exchange commission|\bsec\b/i], ["Kraken", /\bkraken\b/i], ["United Nations", /united nations|security council/i],
  ["Russia", /russia|russian/i], ["Ukraine", /ukraine|ukrainian/i], ["China", /china|chinese|prc/i], ["Middle East", /iran|israel|gaza|lebanon|red sea/i],
];

function decode(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
function tag(block: string, name: string): string | null { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")); return match ? decode(match[1] ?? "") : null; }
function atomLink(block: string): string | null { const match = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i); return match?.[1] ?? tag(block, "link"); }
function parseDate(value: string | null): number | null { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function normalizeTitle(value: string): string { return value.toLowerCase().replace(/[^a-z0-9áéíóúüñ ]/gi, " ").replace(/\s+/g, " ").trim(); }
function topicMatches(lower: string): EventTopic[] { const topics = (Object.entries(TOPIC_TERMS) as Array<[EventTopic, string[]]>).filter(([topic, terms]) => topic !== "other" && terms.some((term) => lower.includes(term))).map(([topic]) => topic); return topics.length ? topics : ["other"]; }
function authorityWeight(authority: NewsAuthority): number { return authority === "central-bank" ? 24 : authority === "government" || authority === "multilateral" ? 22 : authority === "regulator" ? 20 : authority === "cybersecurity" ? 19 : 16; }

function classify(source: NewsSource, title: string, link: string | null, publishedAt: number | null, now: number): NewsSignal {
  const lower = title.toLowerCase();
  const topics = topicMatches(lower);
  const offMatches = RISK_OFF.filter((term) => lower.includes(term));
  const onMatches = RISK_ON.filter((term) => lower.includes(term));
  const direction = offMatches.length > onMatches.length ? "risk-off" : onMatches.length > offMatches.length ? "risk-on" : topics[0] !== "other" ? "mixed" : "neutral";
  const weight = authorityWeight(source.authority);
  const critical = topics.filter((topic) => ["war", "sanctions", "monetary-policy", "cybersecurity", "exchange-incident"].includes(topic)).length;
  const ageMinutes = publishedAt ? Math.max(0, (now - publishedAt) / 60000) : null;
  const impactScore = Math.min(100, 10 + weight + topics.length * 8 + critical * 16 + (ageMinutes !== null && ageMinutes <= 15 ? 10 : 0));
  const confidence = Math.min(0.99, 0.64 + weight / 100 + Math.min(0.12, critical * 0.04));
  const assets = new Set(source.defaultAssets);
  if (/gold|xaut|precious metal|war|sanction/.test(lower)) assets.add("XAUT");
  if (/bitcoin|btc|crypto|digital asset/.test(lower)) assets.add("BTC");
  if (/ethereum|ether|eth/.test(lower)) assets.add("ETH");
  if (/euro|ecb/.test(lower)) assets.add("EUR");
  if (/dollar|federal reserve|fomc|treasury/.test(lower)) assets.add("USD");
  if (/oil|gas|energy|opec|pipeline/.test(lower)) assets.add("ENERGY");
  const namedEntities = ENTITY_PATTERNS.filter(([, pattern]) => pattern.test(title)).map(([entity]) => entity);
  return { id: `${source.id}:${publishedAt ?? 0}:${normalizeTitle(title)}`, sourceId: source.id, source: source.label, title, link, publishedAt, detectedAt: now, impactScore, confidence, direction, urgency: impactScore >= 78 && (ageMinutes === null || ageMinutes <= 60) ? "breaking" : impactScore >= 60 ? "high" : "normal", verification: "primary-source", corroboratingSources: 1, topics, namedEntities, assets: [...assets], reasons: [`Fuente primaria: ${source.label}`, ...topics.map((topic) => `Tema detectado: ${topic}`)] };
}

function parseFeed(source: NewsSource, xml: string, now: number): NewsSignal[] {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1] ?? "");
  return blocks.slice(0, 25).flatMap((block) => { const title = tag(block, "title"); if (!title) return []; const publishedAt = parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated")); return [classify(source, title, atomLink(block), publishedAt, now)]; });
}

function parseHtml(source: NewsSource, html: string, now: number): NewsSignal[] {
  const candidates = [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({ href: match[1] ?? "", title: decode(match[2] ?? "") })).filter((item) => item.title.length >= 24 && item.title.length <= 220);
  const unique = new Map<string, { href: string; title: string }>();
  for (const item of candidates) { const key = normalizeTitle(item.title); if (!unique.has(key)) unique.set(key, item); if (unique.size >= 25) break; }
  return [...unique.values()].map((item) => { let link: string | null = item.href; try { link = new URL(item.href, source.url).toString(); } catch { link = null; } return classify(source, item.title, link, null, now); });
}

async function fetchSource(source: NewsSource, now: number): Promise<{ signals: NewsSignal[]; status: NewsIntelligenceReport["sourceStatus"][number] }> {
  const started = Date.now();
  try {
    const response = await fetch(source.url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/html;q=0.8", "User-Agent": "Auto-Bolsa-AI/2.0 research-only" }, cf: { cacheTtl: 60, cacheEverything: true } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.text();
    const signals = source.format === "feed" ? parseFeed(source, body, now) : parseHtml(source, body, now);
    return { signals, status: { id: source.id, label: source.label, available: true, items: signals.length, latencyMs: Date.now() - started, error: null } };
  } catch (error) {
    return { signals: [], status: { id: source.id, label: source.label, available: false, items: 0, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "NEWS_SOURCE_FAILED" } };
  }
}

function corroborate(signals: NewsSignal[]): NewsSignal[] {
  return signals.map((signal) => {
    const tokens = new Set(normalizeTitle(signal.title).split(" ").filter((token) => token.length >= 5));
    const related = signals.filter((candidate) => candidate.sourceId !== signal.sourceId && normalizeTitle(candidate.title).split(" ").filter((token) => token.length >= 5).filter((token) => tokens.has(token)).length >= 3);
    if (related.length === 0) return signal;
    return { ...signal, verification: "corroborated-primary" as const, corroboratingSources: 1 + new Set(related.map((item) => item.sourceId)).size, confidence: Math.min(0.995, signal.confidence + 0.05), impactScore: Math.min(100, signal.impactScore + 5), reasons: [...signal.reasons, `Corroborada por ${new Set(related.map((item) => item.sourceId)).size} fuente(s) primaria(s) adicional(es)`] };
  });
}

export async function buildNewsIntelligence(now = Date.now()): Promise<NewsIntelligenceReport> {
  const results = await Promise.all(OFFICIAL_NEWS_SOURCES.map((source) => fetchSource(source, now)));
  const signals = corroborate(results.flatMap((result) => result.signals)).sort((left, right) => right.impactScore - left.impactScore || (right.publishedAt ?? 0) - (left.publishedAt ?? 0)).slice(0, 100);
  return { schemaVersion: "global-news-intelligence-v2", generatedAt: now, refreshTargetSeconds: 60, sourcesConfigured: OFFICIAL_NEWS_SOURCES.length, sourcesAvailable: results.filter((result) => result.status.available).length, signals, breakingSignals: signals.filter((signal) => signal.urgency === "breaking").length, highImpactSignals: signals.filter((signal) => signal.impactScore >= 60).length, coverage: { regions: [...new Set(OFFICIAL_NEWS_SOURCES.flatMap((source) => source.regions))], topics: Object.keys(TOPIC_TERMS) as EventTopic[], primarySourcesOnly: true, impossibleToGuaranteeTotalWorldCoverage: true }, sourceStatus: results.map((result) => result.status), changesTradingDecision: false, advisoryOnly: true, eligibleForLiveReview: false, liveTrading: false };
}
