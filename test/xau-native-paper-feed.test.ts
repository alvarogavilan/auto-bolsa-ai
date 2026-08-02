import { describe, expect, it } from "vitest";
import fs from "node:fs";

const feedSource = fs.readFileSync("src/xau-native-paper-feed.ts", "utf8");
const runtimeSource = fs.readFileSync("src/index-paper-capital.ts", "utf8");
const wranglerSource = fs.readFileSync("wrangler.jsonc", "utf8");

describe("native XAU PAPER feed architecture", () => {
  it("uses public Kraken XAUT/USD market data without enabling real execution", () => {
    expect(feedSource).toContain("PreTrade?symbol=XAUT/USD");
    expect(feedSource).toContain("PostTrade?symbol=XAUT/USD");
    expect(feedSource).toContain('source: "Kraken public XAUT/USD proxy"');
    expect(runtimeSource).toContain("liveTrading: false");
    expect(runtimeSource).toContain("realOrderSubmission: false");
  });

  it("keeps macro specialists neutral so missing evidence remains a cabinet veto", () => {
    expect(feedSource).toContain('dxyBiasForGold: "neutral"');
    expect(feedSource).toContain('realYieldsBiasForGold: "neutral"');
    expect(feedSource).toContain("sourcesFresh: 1");
    expect(runtimeSource).toContain("mantienen veto PAPER");
  });

  it("runs an automatic native observation cycle when no external feed exists", () => {
    expect(runtimeSource).toContain("buildNativeXauPaperInput");
    expect(runtimeSource).toContain('feedMode: externalFeedConfigured ? "external-plus-native-fast-price" : "native-kraken-xaut-proxy"');
    expect(runtimeSource).toContain("ctx.waitUntil(runXauFastMonitoringWindow");
  });

  it("monitors price and open PAPER positions every three seconds without accelerating the base strategy", () => {
    expect(runtimeSource).toContain("const XAU_FAST_INTERVAL_MS = 3_000");
    expect(runtimeSource).toContain("const XAU_FAST_SAMPLES_PER_MINUTE = 19");
    expect(runtimeSource).toContain("buildNativeXauFastPriceInput");
    expect(runtimeSource).toContain("getUTCMinutes() % 5 === 0");
    expect(wranglerSource).toContain('"crons": ["* * * * *"]');
  });
});
