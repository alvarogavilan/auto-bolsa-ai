import { describe, expect, it } from "vitest";
import fs from "node:fs";

const feedSource = fs.readFileSync("src/xau-native-paper-feed.ts", "utf8");
const macroSource = fs.readFileSync("src/xau-official-macro-feed.ts", "utf8");
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

  it("unwraps Kraken result envelopes before reading book and trade data", () => {
    expect(feedSource).toContain("interface KrakenPreTradeResponse { result?: KrakenPreTradeBook");
    expect(feedSource).toContain("interface KrakenPostTradeResponse { result?: KrakenPostTradeTape");
    expect(feedSource).toContain("function requireResult");
    expect(feedSource).toContain('requireResult(bookResponse, "pre-trade")');
    expect(feedSource).toContain('requireResult(tapeResponse, "post-trade")');
  });

  it("uses official Fed/FRED macro series without weakening the strict PAPER fallback", () => {
    expect(feedSource).toContain('buildOfficialXauMacroEvidence(now)');
    expect(macroSource).toContain('id: "DTWEXBGS"');
    expect(macroSource).toContain('id: "DFII10"');
    expect(macroSource).toContain('id: "DFF"');
    expect(macroSource).toContain('id: "CPIAUCSL"');
    expect(macroSource).toContain("Promise.allSettled");
    expect(macroSource).toContain('sourcesAvailable: 0');
    expect(macroSource).toContain('sourcesFresh: 0');
    expect(runtimeSource).toContain('"strict-technical-paper-fallback"');
    expect(runtimeSource).toContain('"Unanimidad técnica 100 %"');
    expect(runtimeSource).toContain('"spread <= 0,05 %"');
    expect(runtimeSource).toContain('"asimetría >= 2,5R"');
  });

  it("persists an automatic native decision before starting background monitoring", () => {
    expect(runtimeSource).toContain("buildNativeXauPaperInput");
    expect(runtimeSource).toContain('feedMode: externalFeedConfigured ? "external-plus-native-fast-price" : "native-kraken-xaut-plus-official-macro"');
    const decision = runtimeSource.indexOf("await runXauDecisionCycle(runtimeEnv)");
    const monitoring = runtimeSource.indexOf("ctx.waitUntil(runXauFastMonitoringSamples(runtimeEnv))");
    expect(decision).toBeGreaterThan(-1);
    expect(monitoring).toBeGreaterThan(decision);
    expect(runtimeSource).not.toContain("runXauDecisionCycle(runtimeEnv).catch");
  });

  it("monitors price and open PAPER positions every three seconds without accelerating the base strategy", () => {
    expect(runtimeSource).toContain("const XAU_FAST_INTERVAL_MS = 3_000");
    expect(runtimeSource).toContain("const XAU_FAST_SAMPLES_PER_MINUTE = 19");
    expect(runtimeSource).toContain("buildNativeXauFastPriceInput");
    expect(runtimeSource).toContain("getUTCMinutes() % 5 === 0");
    expect(wranglerSource).toContain('"crons": ["*/2 * * * *"]');
  });
});
