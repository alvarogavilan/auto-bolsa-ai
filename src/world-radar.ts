import { RADAR_SOURCES, WORLD_BOARD, type RadarKind, type RadarSource } from "./world-radar-sources";

/**
 * Radar Mundial: vigilancia gratuita de medios, redes sociales públicas,
 * hechos relevantes de empresas y mercados globales.
 *
 * Es INFORMATIVO. No cambia ninguna orden de compra/venta: el tono de titulares
 * y redes no ha demostrado, en la simulación de esta app, que mejore el
 * resultado, y por eso no se le da autoridad para operar.
 */

export type RadarTopic = "gold" | "bitcoin" | "ethereum" | "crypto" | "stocks" | "macro" | "energy" | "geopolitics";

export interface RadarItem {
  sourceId: string;
  source: string;
  kind: RadarKind;
  title: string;
  link: string | null;
  publishedAt: number | null;
  topics: RadarTopic[];
  companies: string[];
  tone: number;
}

export interface RadarPulse {
  topic: RadarTopic;
  label: string;
  mentions: number;
  mediaMentions: number;
  socialMentions: number;
  tone: number;
  mediaTone: number | null;
  socialTone: number | null;
  verdict: "Muy positivo" | "Positivo" | "Neutro" | "Negativo" | "Muy negativo" | "Sin datos";
  headlines: Array<{ title: string; source: string; link: string | null; tone: number }>;
}

export interface WorldRadarReport {
  schemaVersion: "world-radar-v1";
  generatedAt: number;
  sourcesConfigured: number;
  sourcesAvailable: number;
  itemsAnalysed: number;
  pulses: RadarPulse[];
  companies: Array<{ name: string; mentions: number; tone: number; headline: string; link: string | null }>;
  filings: Array<{ title: string; link: string | null; publishedAt: number | null }>;
  trending: { stocks: string[]; coins: string[] };
  fearGreed: { value: number; label: string } | null;
  latest: RadarItem[];
  sourceStatus: Array<{ id: string; label: string; kind: RadarKind; available: boolean; items: number; error: string | null }>;
  advisoryOnly: true;
  changesTradingDecision: false;
  disclaimer: string;
}

const TOPIC_LABELS: Record<RadarTopic, string> = {
  gold: "Oro",
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  crypto: "Crypto (general)",
  stocks: "Bolsa",
  macro: "Bancos centrales y macro",
  energy: "Energía",
  geopolitics: "Geopolítica",
};

const TOPIC_PATTERNS: Array<[RadarTopic, RegExp]> = [
  ["gold", /\b(gold|bullion|xau|xauusd|precious metals?|oro|lingotes?)\b/i],
  ["bitcoin", /\b(bitcoin|btc)\b/i],
  ["ethereum", /\b(ethereum|ether|eth)\b/i],
  ["crypto", /\b(crypto\w*|cripto\w*|altcoins?|stablecoins?|defi|binance|coinbase|kraken|solana|xrp|token)\b/i],
  ["stocks", /\b(stocks?|shares?|equit(?:y|ies)|wall street|nasdaq|s&p ?500|dow jones|earnings|ipo|bolsa|ibex|acciones|resultados)\b/i],
  ["macro", /\b(fed|federal reserve|fomc|ecb|bce|central banks?|inflation|inflaci[oó]n|cpi|ipc|interest rates?|tipos de inter[eé]s|rate (?:cut|hike)|yields?|treasur(?:y|ies)|recession|recesi[oó]n|gdp|pib|jobs report|payrolls|dollar|d[oó]lar)\b/i],
  ["energy", /\b(oil|crude|brent|wti|opec|natural gas|petr[oó]leo|gas natural|energy|energ[ií]a)\b/i],
  ["geopolitics", /\b(war|guerra|sanctions?|sanciones|tariffs?|aranceles|missile|invasion|ceasefire|conflict|conflicto|nato|otan|election|elecciones)\b/i],
];

const POSITIVE = /\b(surges?|soars?|rall(?:y|ies)|jumps?|gains?|rises?|climbs?|record high|all-time high|beats?|upgrade[sd]?|bullish|rebounds?|recover(?:y|s)|inflows?|approval|approved|breakout|outperform\w*|strong|boom|optimis\w+|sube|suben|repunta\w*|m[aá]ximos?|r[eé]cord|alcista|gana|ganan|dispara\w*|supera\w*|mejora\w*)\b/gi;
const NEGATIVE = /\b(plunges?|crash(?:es)?|slumps?|tumbles?|falls?|drops?|sinks?|slides?|sell-?off|loss(?:es)?|miss(?:es)?|downgrade[sd]?|bearish|fears?|panic|hack(?:ed)?|exploit|fraud|lawsuit|ban(?:s|ned)?|default|bankrupt\w*|layoffs?|outflows?|warning|weak|recession|liquidat\w+|cae|caen|desplom\w+|hunde\w*|baja|bajan|m[ií]nimos?|bajista|p[eé]rdidas?|quiebra|temor\w*|miedo|recorta\w*)\b/gi;

const COMPANIES: Array<[string, RegExp]> = [
  ["Apple", /\bapple\b|\baapl\b/i], ["Microsoft", /\bmicrosoft\b|\bmsft\b/i], ["Nvidia", /\bnvidia\b|\bnvda\b/i],
  ["Amazon", /\bamazon\b|\bamzn\b/i], ["Alphabet", /\balphabet\b|\bgoogle\b|\bgoogl\b/i], ["Meta", /\bmeta platforms\b|\bfacebook\b|\bmeta\b/],
  ["Tesla", /\btesla\b|\btsla\b/i], ["JPMorgan", /\bjpmorgan\b|\bjp morgan\b/i], ["Goldman Sachs", /\bgoldman\b/i],
  ["BlackRock", /\bblackrock\b/i], ["Berkshire", /\bberkshire\b/i], ["Exxon", /\bexxon\b/i], ["Saudi Aramco", /\baramco\b/i],
  ["TSMC", /\btsmc\b|taiwan semiconductor/i], ["Samsung", /\bsamsung\b/i], ["Intel", /\bintel\b/], ["AMD", /\bamd\b/i],
  ["OpenAI", /\bopenai\b/i], ["Coinbase", /\bcoinbase\b/i], ["Binance", /\bbinance\b/i], ["Strategy", /\bmicrostrategy\b|\bmstr\b/i],
  ["Tether", /\btether\b|\busdt\b/i], ["Newmont", /\bnewmont\b/i], ["Barrick", /\bbarrick\b/i],
  ["Santander", /\bsantander\b/i], ["BBVA", /\bbbva\b/i], ["Inditex", /\binditex\b/i], ["Iberdrola", /\biberdrola\b/i],
  ["Telefónica", /\btelef[oó]nica\b/i], ["Repsol", /\brepsol\b/i], ["Boeing", /\bboeing\b/i], ["Netflix", /\bnetflix\b/i],
];

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  const value = match?.[1] ? decode(match[1]) : "";
  return value || null;
}

function feedLink(block: string): string | null {
  const atom = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
  const candidate = atom ?? tag(block, "link");
  return candidate && /^https:\/\//.test(candidate) ? candidate.replace(/&amp;/g, "&") : null;
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function scoreTone(title: string): number {
  const positive = title.match(POSITIVE)?.length ?? 0;
  const negative = title.match(NEGATIVE)?.length ?? 0;
  if (positive === negative) return 0;
  return Math.max(-1, Math.min(1, (positive - negative) / Math.max(1, positive + negative)));
}

export function classifyRadarItem(source: RadarSource, title: string, link: string | null, publishedAt: number | null): RadarItem {
  const topics = TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(title)).map(([topic]) => topic);
  if ((topics.includes("bitcoin") || topics.includes("ethereum")) && !topics.includes("crypto")) topics.push("crypto");
  return {
    sourceId: source.id,
    source: source.label,
    kind: source.kind,
    title: title.slice(0, 220),
    link,
    publishedAt,
    topics,
    companies: COMPANIES.filter(([, pattern]) => pattern.test(title)).map(([name]) => name),
    tone: scoreTone(title),
  };
}

export function parseRadarFeed(source: RadarSource, xml: string): RadarItem[] {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1] ?? "");
  return blocks.slice(0, 30).flatMap((block) => {
    const title = tag(block, "title");
    if (!title) return [];
    return [classifyRadarItem(source, title, feedLink(block), parseDate(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date")))];
  });
}

interface SourceResult {
  items: RadarItem[];
  stocks: string[];
  coins: string[];
  fearGreed: { value: number; label: string } | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function parseRadarSource(source: RadarSource, body: string): SourceResult {
  const result: SourceResult = { items: [], stocks: [], coins: [], fearGreed: null };
  if (source.format === "rss") {
    result.items = parseRadarFeed(source, body);
    return result;
  }
  const json = record(JSON.parse(body));
  if (source.format === "hn") {
    result.items = list(json.hits).flatMap((hit) => typeof hit.title === "string"
      ? [classifyRadarItem(source, hit.title, typeof hit.url === "string" && hit.url.startsWith("https://") ? hit.url : null, typeof hit.created_at_i === "number" ? hit.created_at_i * 1000 : null)]
      : []);
  } else if (source.format === "mastodon") {
    result.items = (Array.isArray(JSON.parse(body)) ? JSON.parse(body) as unknown[] : []).map(record).flatMap((status) => {
      const text = typeof status.content === "string" ? decode(status.content) : "";
      return text.length >= 20 ? [classifyRadarItem(source, text, typeof status.url === "string" && status.url.startsWith("https://") ? status.url : null, parseDate(typeof status.created_at === "string" ? status.created_at : null))] : [];
    });
  } else if (source.format === "stocktwits") {
    result.stocks = list(json.symbols).map((symbol) => String(symbol.symbol ?? "")).filter(Boolean).slice(0, 10);
  } else if (source.format === "coingecko-trending") {
    result.coins = list(json.coins).map((coin) => String(record(coin.item).symbol ?? "").toUpperCase()).filter(Boolean).slice(0, 10);
  } else if (source.format === "fear-greed") {
    const entry = list(json.data)[0];
    const value = Number(entry?.value);
    if (Number.isFinite(value)) result.fearGreed = { value, label: fearGreedLabel(value) };
  }
  return result;
}

function fearGreedLabel(value: number): string {
  return value <= 24 ? "Miedo extremo" : value <= 44 ? "Miedo" : value <= 55 ? "Neutral" : value <= 75 ? "Codicia" : "Codicia extrema";
}

function verdict(tone: number, mentions: number): RadarPulse["verdict"] {
  if (mentions < 3) return "Sin datos";
  return tone >= 40 ? "Muy positivo" : tone >= 12 ? "Positivo" : tone <= -40 ? "Muy negativo" : tone <= -12 ? "Negativo" : "Neutro";
}

function averageTone(items: RadarItem[]): number | null {
  if (items.length === 0) return null;
  return Math.round((items.reduce((sum, item) => sum + item.tone, 0) / items.length) * 100);
}

function dedupe(items: RadarItem[]): RadarItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, "").split(" ").filter((word) => word.length > 3).slice(0, 8).join(" ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildWorldRadar(
  results: Array<{ source: RadarSource; ok: boolean; error: string | null; parsed: SourceResult | null }>,
  now: number,
): WorldRadarReport {
  const all = dedupe(results.flatMap((result) => result.parsed?.items ?? []))
    .filter((item) => item.publishedAt === null || now - item.publishedAt <= 36 * 3_600_000);
  const news = all.filter((item) => item.kind !== "filings");
  const weight = (item: RadarItem): number => (item.kind === "social" ? 0.5 : 1);

  const pulses = (Object.keys(TOPIC_LABELS) as RadarTopic[]).map((topic): RadarPulse => {
    const items = news.filter((item) => item.topics.includes(topic));
    const media = items.filter((item) => item.kind !== "social");
    const social = items.filter((item) => item.kind === "social");
    const totalWeight = items.reduce((sum, item) => sum + weight(item), 0);
    const tone = totalWeight > 0 ? Math.round((items.reduce((sum, item) => sum + item.tone * weight(item), 0) / totalWeight) * 100) : 0;
    return {
      topic,
      label: TOPIC_LABELS[topic],
      mentions: items.length,
      mediaMentions: media.length,
      socialMentions: social.length,
      tone,
      mediaTone: averageTone(media),
      socialTone: averageTone(social),
      verdict: verdict(tone, items.length),
      headlines: [...media, ...social]
        .sort((left, right) => Math.abs(right.tone) - Math.abs(left.tone) || (right.publishedAt ?? 0) - (left.publishedAt ?? 0))
        .slice(0, 4)
        .map((item) => ({ title: item.title, source: item.source, link: item.link, tone: item.tone })),
    };
  });

  const companyMap = new Map<string, RadarItem[]>();
  for (const item of news) for (const company of item.companies) companyMap.set(company, [...(companyMap.get(company) ?? []), item]);
  const companies = [...companyMap.entries()]
    .map(([name, items]) => ({ name, mentions: items.length, tone: averageTone(items) ?? 0, headline: items[0]?.title ?? "", link: items[0]?.link ?? null }))
    .sort((left, right) => right.mentions - left.mentions)
    .slice(0, 15);

  return {
    schemaVersion: "world-radar-v1",
    generatedAt: now,
    sourcesConfigured: results.length,
    sourcesAvailable: results.filter((result) => result.ok).length,
    itemsAnalysed: all.length,
    pulses,
    companies,
    filings: all.filter((item) => item.kind === "filings").slice(0, 12).map((item) => ({ title: item.title, link: item.link, publishedAt: item.publishedAt })),
    trending: {
      stocks: results.flatMap((result) => result.parsed?.stocks ?? []).slice(0, 10),
      coins: results.flatMap((result) => result.parsed?.coins ?? []).slice(0, 10),
    },
    fearGreed: results.map((result) => result.parsed?.fearGreed ?? null).find((value) => value !== null) ?? null,
    latest: [...news].filter((item) => item.topics.length > 0).sort((left, right) => (right.publishedAt ?? 0) - (left.publishedAt ?? 0)).slice(0, 40),
    sourceStatus: results.map((result) => ({ id: result.source.id, label: result.source.label, kind: result.source.kind, available: result.ok, items: result.parsed?.items.length ?? 0, error: result.error })),
    advisoryOnly: true,
    changesTradingDecision: false,
    disclaimer: "El tono de medios y redes es informativo: no predice el precio y no modifica las órdenes de la app.",
  };
}

const RADAR_USER_AGENT = "Mozilla/5.0 (compatible; AutoBolsaRadar/1.0; research-only)";

/** Cloudflare Workers admite 6 conexiones salientes simultáneas: el resto haría cola y caducaría. */
const RADAR_CONCURRENCY = 6;
const RADAR_SOURCE_TIMEOUT_MS = 5_000;

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  }));
  return results;
}

export async function fetchWorldRadar(now = Date.now(), sources: RadarSource[] = RADAR_SOURCES): Promise<WorldRadarReport> {
  const results = await mapWithConcurrency(sources, RADAR_CONCURRENCY, async (source) => {
    try {
      const response = await fetch(source.url, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9, */*;q=0.5", "User-Agent": RADAR_USER_AGENT },
        signal: AbortSignal.timeout(RADAR_SOURCE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return { source, ok: true, error: null, parsed: parseRadarSource(source, await response.text()) };
    } catch (error) {
      return { source, ok: false, error: error instanceof Error ? error.message.slice(0, 80) : "FAILED", parsed: null };
    }
  });
  return buildWorldRadar(results, now);
}

// ---------------------------------------------------------------------------
// Tablero mundial de mercados (Stooq)
// ---------------------------------------------------------------------------

export interface WorldQuote {
  symbol: string;
  label: string;
  group: string;
  price: number;
  changePct: number | null;
  date: string;
}

/** Respuesta de `v7/finance/spark`: precio actual y cierre anterior por símbolo. */
export function parseYahooSpark(payload: unknown): WorldQuote[] {
  const bySymbol = new Map(WORLD_BOARD.map((entry) => [entry.symbol, entry]));
  return list(record(record(payload).spark).result).flatMap((row) => {
    const entry = bySymbol.get(String(row.symbol ?? ""));
    const meta = record(list(row.response)[0]?.meta);
    const price = Number(meta.regularMarketPrice);
    const previous = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (!entry || !Number.isFinite(price) || price <= 0) return [];
    const time = Number(meta.regularMarketTime);
    return [{
      symbol: entry.symbol,
      label: entry.label,
      group: entry.group,
      price,
      changePct: Number.isFinite(previous) && previous > 0 ? ((price - previous) / previous) * 100 : null,
      date: Number.isFinite(time) ? new Date(time * 1000).toISOString() : "",
    }];
  });
}

const BOARD_CHUNK = 17;

export async function fetchWorldBoard(): Promise<{ quotes: WorldQuote[]; available: boolean; error: string | null }> {
  const chunks: string[][] = [];
  for (let index = 0; index < WORLD_BOARD.length; index += BOARD_CHUNK) chunks.push(WORLD_BOARD.slice(index, index + BOARD_CHUNK).map((entry) => entry.symbol));
  const settled = await Promise.allSettled(chunks.map(async (symbols) => {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1d&interval=1d`;
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": RADAR_USER_AGENT }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseYahooSpark(await response.json<unknown>());
  }));
  const found = settled.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
  const order = new Map(WORLD_BOARD.map((entry, index) => [entry.symbol, index]));
  const quotes = found.sort((left, right) => (order.get(left.symbol) ?? 0) - (order.get(right.symbol) ?? 0));
  const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  return {
    quotes,
    available: quotes.length > 0,
    error: quotes.length > 0 ? null : failure ? String(failure.reason instanceof Error ? failure.reason.message : failure.reason).slice(0, 80) : "SIN_COTIZACIONES",
  };
}
