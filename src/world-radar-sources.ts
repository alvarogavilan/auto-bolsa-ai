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
  { id: "yahoo-finance", label: "Yahoo Finance", kind: "media", format: "rss", lang: "en", url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US" },
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
  { id: "investing-commodities", label: "Investing · materias primas", kind: "media", format: "rss", lang: "en", url: "https://www.investing.com/rss/news_11.rss" },
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
];

/** Tablero mundial (Yahoo Finance, gratuito y sin clave). Símbolos en formato Yahoo. */
export type WorldBoardGroup = "Índices" | "Divisas" | "Materias primas" | "Empresas" | "Crypto";
export const WORLD_BOARD: Array<{ symbol: string; label: string; group: WorldBoardGroup }> = [
  { symbol: "^GSPC", label: "S&P 500", group: "Índices" },
  { symbol: "^IXIC", label: "Nasdaq", group: "Índices" },
  { symbol: "^DJI", label: "Dow Jones", group: "Índices" },
  { symbol: "^GDAXI", label: "DAX (Alemania)", group: "Índices" },
  { symbol: "^IBEX", label: "IBEX 35", group: "Índices" },
  { symbol: "^FTSE", label: "FTSE 100", group: "Índices" },
  { symbol: "^N225", label: "Nikkei 225", group: "Índices" },
  { symbol: "^HSI", label: "Hang Seng", group: "Índices" },
  { symbol: "EURUSD=X", label: "EUR/USD", group: "Divisas" },
  { symbol: "JPY=X", label: "USD/JPY", group: "Divisas" },
  { symbol: "GBPUSD=X", label: "GBP/USD", group: "Divisas" },
  { symbol: "GC=F", label: "Oro (futuro, USD)", group: "Materias primas" },
  { symbol: "SI=F", label: "Plata", group: "Materias primas" },
  { symbol: "CL=F", label: "Petróleo WTI", group: "Materias primas" },
  { symbol: "NG=F", label: "Gas natural", group: "Materias primas" },
  { symbol: "HG=F", label: "Cobre", group: "Materias primas" },
  { symbol: "BTC-USD", label: "Bitcoin (USD)", group: "Crypto" },
  { symbol: "ETH-USD", label: "Ethereum (USD)", group: "Crypto" },
  { symbol: "AAPL", label: "Apple", group: "Empresas" },
  { symbol: "MSFT", label: "Microsoft", group: "Empresas" },
  { symbol: "NVDA", label: "Nvidia", group: "Empresas" },
  { symbol: "AMZN", label: "Amazon", group: "Empresas" },
  { symbol: "GOOGL", label: "Alphabet", group: "Empresas" },
  { symbol: "META", label: "Meta", group: "Empresas" },
  { symbol: "TSLA", label: "Tesla", group: "Empresas" },
  { symbol: "JPM", label: "JPMorgan", group: "Empresas" },
  { symbol: "XOM", label: "Exxon", group: "Empresas" },
  { symbol: "NEM", label: "Newmont (minera de oro)", group: "Empresas" },
  { symbol: "COIN", label: "Coinbase", group: "Empresas" },
  { symbol: "MSTR", label: "Strategy (MicroStrategy)", group: "Empresas" },
  { symbol: "SAN.MC", label: "Santander", group: "Empresas" },
  { symbol: "BBVA.MC", label: "BBVA", group: "Empresas" },
  { symbol: "ITX.MC", label: "Inditex", group: "Empresas" },
  { symbol: "IBE.MC", label: "Iberdrola", group: "Empresas" },
];
