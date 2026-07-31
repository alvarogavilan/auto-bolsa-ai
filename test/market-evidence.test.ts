import { describe, expect, it } from "vitest";
import { selectMarketObservation } from "../src/market-evidence";
import type { Candle } from "../src/types";

function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe("closed-candle market evidence", () => {
  const candles = [candle(100, 10), candle(200, 11), candle(300, 12), candle(400, 13)];

  it("excludes Kraken's final in-progress candle from strategy evidence", () => {
    const observation = selectMarketObservation(candles, null);
    expect(observation.currentPrice).toBe(13);
    expect(observation.closedCandles.map((item) => item.time)).toEqual([100, 200, 300]);
    expect(observation.latestClosedCandleTime).toBe(300);
  });

  it("marks repeated cron calls for the same closed candle as duplicates", () => {
    const observation = selectMarketObservation(candles, 300);
    expect(observation.isNewClosedCandle).toBe(false);
  });

  it("accepts exactly one observation when a new candle closes", () => {
    const observation = selectMarketObservation(candles, 200);
    expect(observation.isNewClosedCandle).toBe(true);
  });
});
