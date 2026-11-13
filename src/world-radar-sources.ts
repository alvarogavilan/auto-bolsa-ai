/**
 * Catálogo de fuentes GRATUITAS y sin clave del Radar Mundial.
 *
 * Presupuesto: un Worker gratuito admite 50 subpeticiones por invocación; el
 * radar usa como máximo `RADAR_SOURCES.length` (< 45) y el tablero de mercados
 * va en un endpoint aparte.
 */
export type RadarKind = "media" | "aggregator" | "social" | "filings";
export type RadarFormat = "rss" | "hn" | "stocktwits" | "coingecko-trending" | "fear-greed" | "mastodon";

export interface RadarSource {
  id: string;
  label: string;
  kind: RadarKind;
  format: RadarFormat;
  url: string;
  lang: "en" | "es";
}

const gnews = (query: string, lang: "en" | "es"): string =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=${lang === "es" ? "es&gl=ES&ceid=ES:es" : "en-US&gl=US&ceid=US:en"}`;

export const RADAR_SOURCES: RadarSource[] = [
  // Medios financieros y generalistas internacionales
  { id: "bbc-business", label: "BBC Business", kind: "media", format: "rss", lang: "en", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { id: "cnbc-top", label: "CNBC", kind: "media", format: "rss", lang: "en", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "cnbc-markets", label: "CNBC Markets", kind: "media", format: "rss", lang: "en", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html" },
  { id: "marketwatch", label: "MarketWatch", kind: "media", format: "rss", lang: "en", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "wsj-markets", label: "WSJ Markets", kind: "media", format: "rss", lang: "en", url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" },
  { id: "yahoo-finance", label: "Yahoo Finance", kind: "media", format: "rss", lang: "en", url: "https://finance.yahoo.com/news/rssindex" },
  { id: "guardian-business", label: "The Guardian", kind: "media", format: "rss", lang: "en", url: "https://www.theguardian.com/uk/business/rss" },
  { id: "nyt-business", label: "New York Times", kind: "media", format: "rss", lang: "en", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { id: "ft-markets", label: "Financial Times", kind: "media", format: "rss", lang: "en", url: "https://www.ft.com/markets?format=rss" },
  { id: "aljazeera", label: "Al Jazeera", kind: "media", format: "rss", lang: "en", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "dw-business", label: "Deutsche Welle", kind: "media", format: "rss", lang: "en", url: "https://rss.dw.com/rdf/rss-en-bus" },
  { id: "investing", label: "Investing.com", kind: "media", format: "rss", lang: "en", url: "https://www.investing.com/rss/news.rss" },
  // Medios en español
  { id: "expansion", label: "Expansión", kind: "media", format: "rss", lang: "es", url: "https://e00-expansion.uecdn.es/rss/mercados.xml" },
  { id: "eleconomista", label: "elEconomista", kind: "media", format: "rss", lang: "es", url: "https://www.eleconomista.es/rss/rss-mercados.php" },
  { id: "cincodias", label: "Cinco Días", kind: "media", format: "rss", lang: "es", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/cincodias.elpais.com/portada" },
  // Oro y materias primas
  { id: "kitco", label: "Kitco (oro)", kind: "media", format: "rss", lang: "en", url: "https://www.kitco.com/rss/KitcoNews.xml" },
  { id: "mining", label: "Mining.com", kind: "media", format: "rss", lang: "en", url: "https://www.mining.com/feed/" },
  { id: "oilprice", label: "OilPrice", kind: "media", format: "rss", lang: "en", url: "https://oilprice.com/rss/main" },
  // Crypto
  { id: "coindesk", label: "CoinDesk", kind: "media", format: "rss", lang: "en", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { id: "cointelegraph", label: "Cointelegraph", kind: "media", format: "rss", lang: "en", url: "https://cointelegraph.com/rss" },
  { id: "decrypt", label: "Decrypt", kind: "media", format: "rss", lang: "en", url: "https://decrypt.co/feed" },
  { id: "theblock", label: "The Block", kind: "media", format: "rss", lang: "en", url: "https://www.theblock.co/rss.xml" },
  { id: "bitcoinmagazine", label: "Bitcoin Magazine", kind: "media", format: "rss", lang: "en", url: "https://bitcoinmagazine.com/feed" },
  // Agregador mundial (miles de medios) por tema
  { id: "gnews-gold", label: "Google News · oro", kind: "aggregator", format: "rss", lang: "en", url: gnews("gold price OR bullion OR XAUUSD", "en") },
  { id: "gnews-crypto", label: "Google News · crypto", kind: "aggregator", format: "rss", lang: "en", url: gnews("bitcoin OR ethereum OR crypto market", "en") },
  { id: "gnews-macro", label: "Google News · macro", kind: "aggregator", format: "rss", lang: "en", url: gnews("Federal Reserve OR ECB OR inflation OR interest rates", "en") },
  { id: "gnews-stocks", label: "Google News · bolsa", kind: "aggregator", format: "rss", lang: "en", url: gnews("stock market OR Wall Street OR earnings", "en") },
  { id: "gnews-geo", label: "Google News · geopolítica", kind: "aggregator", format: "rss", lang: "en", url: gnews("sanctions OR war OR tariffs OR oil supply", "en") },
  { id: "gnews-es", label: "Google News · mercados (ES)", kind: "aggregator", format: "rss", lang: "es", url: gnews("bolsa OR Ibex OR BCE OR oro OR bitcoin", "es") },
  // Redes sociales públicas (solo lectura)
  { id: "reddit-wsb", label: "Reddit r/wallstreetbets", kind: "social", format: "rss", lang: "en", url: "https://www.reddit.com/r/wallstreetbets/hot/.rss?limit=25" },
  { id: "reddit-crypto", label: "Reddit r/CryptoCurrency", kind: "social", format: "rss", lang: "en", url: "https://www.reddit.com/r/CryptoCurrency/hot/.rss?limit=25" },
  { id: "reddit-gold", label: "Reddit r/Gold", kind: "social", format: "rss", lang: "en", url: "https://www.reddit.com/r/Gold/hot/.rss?limit=25" },
  { id: "reddit-stocks", label: "Reddit r/stocks", kind: "social", format: "rss", lang: "en", url: "https://www.reddit.com/r/stocks/hot/.rss?limit=25" },
  { id: "reddit-investing", label: "Reddit r/investing", kind: "social", format: "rss", lang: "en", url: "https://www.reddit.com/r/investing/hot/.rss?limit=25" },
  { id: "hackernews", label: "Hacker News", kind: "social", format: "hn", lang: "en", url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30&query=bitcoin%20OR%20gold%20OR%20stocks%20OR%20inflation%20OR%20crypto" },
  { id: "mastodon-bitcoin", label: "Mastodon #bitcoin", kind: "social", format: "mastodon", lang: "en", url: "https://mastodon.social/api/v1/timelines/tag/bitcoin?limit=20" },
  { id: "mastodon-gold", label: "Mastodon #gold", kind: "social", format: "mastodon", lang: "en", url: "https://mastodon.social/api/v1/timelines/tag/gold?limit=20" },
  { id: "stocktwits", label: "Stocktwits tendencias", kind: "social", format: "stocktwits", lang: "en", url: "https://api.stocktwits.com/api/2/trending/symbols.json" },
  { id: "coingecko-trending", label: "CoinGecko tendencias", kind: "social", format: "coingecko-trending", lang: "en", url: "https://api.coingecko.com/api/v3/search/trending" },
  { id: "fear-greed", label: "Índice Miedo/Codicia crypto", kind: "social", format: "fear-greed", lang: "en", url: "https://api.alternative.me/fng/?limit=1" },
  // Empresas: hechos relevantes oficiales (SEC, formulario 8-K)
  { id: "sec-8k", label: "SEC · hechos relevantes (8-K)", kind: "filings", format: "rss", lang: "en", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=40&output=atom" },
];

/** Tablero mundial (Stooq, CSV gratuito sin clave). */
export const WORLD_BOARD: Array<{ symbol: string; label: string; group: "Índices" | "Divisas" | "Materias primas" | "Empresas" | "Crypto" }> = [
  { symbol: "^spx", label: "S&P 500", group: "Índices" },
  { symbol: "^ndq", label: "Nasdaq", group: "Índices" },
  { symbol: "^dji", label: "Dow Jones", group: "Índices" },
  { symbol: "^dax", label: "DAX (Alemania)", group: "Índices" },
  { symbol: "^ibex", label: "IBEX 35", group: "Índices" },
  { symbol: "^ukx", label: "FTSE 100", group: "Índices" },
  { symbol: "^nkx", label: "Nikkei 225", group: "Índices" },
  { symbol: "^hsi", label: "Hang Seng", group: "Índices" },
  { symbol: "eurusd", label: "EUR/USD", group: "Divisas" },
  { symbol: "usdjpy", label: "USD/JPY", group: "Divisas" },
  { symbol: "gbpusd", label: "GBP/USD", group: "Divisas" },
  { symbol: "xauusd", label: "Oro (XAU/USD)", group: "Materias primas" },
  { symbol: "xagusd", label: "Plata", group: "Materias primas" },
  { symbol: "cl.f", label: "Petróleo WTI", group: "Materias primas" },
  { symbol: "ng.f", label: "Gas natural", group: "Materias primas" },
  { symbol: "hg.f", label: "Cobre", group: "Materias primas" },
  { symbol: "btcusd", label: "Bitcoin (USD)", group: "Crypto" },
  { symbol: "ethusd", label: "Ethereum (USD)", group: "Crypto" },
  { symbol: "aapl.us", label: "Apple", group: "Empresas" },
  { symbol: "msft.us", label: "Microsoft", group: "Empresas" },
  { symbol: "nvda.us", label: "Nvidia", group: "Empresas" },
  { symbol: "amzn.us", label: "Amazon", group: "Empresas" },
  { symbol: "googl.us", label: "Alphabet", group: "Empresas" },
  { symbol: "meta.us", label: "Meta", group: "Empresas" },
  { symbol: "tsla.us", label: "Tesla", group: "Empresas" },
  { symbol: "jpm.us", label: "JPMorgan", group: "Empresas" },
  { symbol: "xom.us", label: "Exxon", group: "Empresas" },
  { symbol: "nem.us", label: "Newmont (minera de oro)", group: "Empresas" },
  { symbol: "coin.us", label: "Coinbase", group: "Empresas" },
  { symbol: "mstr.us", label: "Strategy (MicroStrategy)", group: "Empresas" },
];
