import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorldRadar, fetchWorldRadar, parseRadarSource, parseStooqCsv, scoreTone } from "../src/world-radar";
import { RADAR_SOURCES, WORLD_BOARD, type RadarSource } from "../src/world-radar-sources";
import { radarScreen } from "../src/radar-screen";

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

const media: RadarSource = { id: "m", label: "Medio", kind: "media", format: "rss", lang: "en", url: "https://example.com/rss" };
const social: RadarSource = { id: "s", label: "Red", kind: "social", format: "rss", lang: "en", url: "https://example.com/social" };

function rss(titles: string[]): string {
  return `<rss><channel>${titles.map((title, index) => `<item><title><![CDATA[${title}]]></title><link>https://example.com/${index}</link><pubDate>${new Date(NOW - 60_000).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
}

describe("world radar", () => {
  it("stays inside the free Worker subrequest budget and uses only https sources", () => {
    expect(RADAR_SOURCES.length).toBeLessThan(45);
    expect(RADAR_SOURCES.every((source) => source.url.startsWith("https://"))).toBe(true);
    expect(new Set(RADAR_SOURCES.map((source) => source.id)).size).toBe(RADAR_SOURCES.length);
  });

  it("scores tone in English and Spanish", () => {
    expect(scoreTone("Gold surges to record high as dollar weakens")).toBeGreaterThan(0);
    expect(scoreTone("Bitcoin crashes after exchange hack")).toBeLessThan(0);
    expect(scoreTone("El oro sube y marca máximos")).toBeGreaterThan(0);
    expect(scoreTone("El Ibex cae por temor a la recesión")).toBeLessThan(0);
    expect(scoreTone("Central bank meets on Thursday")).toBe(0);
  });

  it("builds per-topic pulses, weighting media above social, and tracks companies", () => {
    const report = buildWorldRadar([
      { source: media, ok: true, error: null, parsed: parseRadarSource(media, rss(["Gold surges to record high", "Gold rallies as Fed signals rate cut", "Nvidia beats earnings expectations", "Gold gains again"])) },
      { source: social, ok: true, error: null, parsed: parseRadarSource(social, rss(["Gold will crash, sell everything"])) },
      { source: { ...media, id: "down" }, ok: false, error: "HTTP_403", parsed: null },
    ], NOW);
    const gold = report.pulses.find((pulse) => pulse.topic === "gold");
    expect(gold?.mentions).toBe(4);
    expect(gold?.mediaMentions).toBe(3);
    expect(gold?.socialMentions).toBe(1);
    expect(gold?.tone).toBeGreaterThan(40);
    expect(gold?.verdict).toBe("Muy positivo");
    expect(report.companies[0]?.name).toBe("Nvidia");
    expect(report.sourcesAvailable).toBe(2);
    expect(report.sourcesConfigured).toBe(3);
    expect(report.changesTradingDecision).toBe(false);
  });

  it("reports 'Sin datos' instead of inventing a verdict", () => {
    const report = buildWorldRadar([{ source: media, ok: true, error: null, parsed: parseRadarSource(media, rss(["Gold surges"])) }], NOW);
    expect(report.pulses.find((pulse) => pulse.topic === "gold")?.verdict).toBe("Sin datos");
  });

  it("parses social JSON sources", () => {
    const fng = parseRadarSource({ ...social, format: "fear-greed" }, JSON.stringify({ data: [{ value: "18" }] }));
    expect(fng.fearGreed).toEqual({ value: 18, label: "Miedo extremo" });
    const trending = parseRadarSource({ ...social, format: "coingecko-trending" }, JSON.stringify({ coins: [{ item: { symbol: "sol" } }] }));
    expect(trending.coins).toEqual(["SOL"]);
    const stocks = parseRadarSource({ ...social, format: "stocktwits" }, JSON.stringify({ symbols: [{ symbol: "NVDA" }] }));
    expect(stocks.stocks).toEqual(["NVDA"]);
    const hn = parseRadarSource({ ...social, format: "hn" }, JSON.stringify({ hits: [{ title: "Bitcoin falls", url: "https://x.test/a", created_at_i: NOW / 1000 }] }));
    expect(hn.items[0]?.topics).toContain("bitcoin");
  });

  it("fails open: a dead source never breaks the report", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("social")) throw new Error("network down");
      return new Response(rss(["Bitcoin rallies", "Bitcoin jumps", "Bitcoin gains"]));
    }) as typeof fetch;
    const report = await fetchWorldRadar(NOW, [media, social]);
    expect(report.sourcesAvailable).toBe(1);
    expect(report.sourceStatus.find((status) => status.id === "s")?.error).toBe("network down");
    expect(report.pulses.find((pulse) => pulse.topic === "bitcoin")?.verdict).toBe("Muy positivo");
  });

  it("parses the Stooq world board and skips missing quotes", () => {
    const quotes = parseStooqCsv("Symbol,Date,Time,Open,High,Low,Close,Volume\n^SPX,2026-11-12,22:00:00,6000,6100,5990,6060,1\nXAUUSD,2026-11-13,10:00:00,4000,4050,3990,3960,0\nNOPE,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n");
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.label).toBe("S&P 500");
    expect(quotes[0]?.changePct).toBeCloseTo(1);
    expect(quotes[1]?.changePct).toBeCloseTo(-1);
    expect(WORLD_BOARD.length).toBeGreaterThanOrEqual(30);
  });

  it("serves the radar screen without HTML injection sinks", async () => {
    const html = await radarScreen().text();
    expect(html).toContain("/api/radar");
    expect(html).toContain("no una orden");
    expect(html).not.toContain("innerHTML");
  });
});
