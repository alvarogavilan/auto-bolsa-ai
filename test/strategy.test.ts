import { describe, expect, it } from "vitest";
import { decide, ema, rsi } from "../src/strategy";

const indicatorBase = {
  fastEma: 101,
  slowEma: 100,
  previousFastEma: 99,
  previousSlowEma: 100,
  rsi: 55,
  price: 100,
};

describe("indicators", () => {
  it("calculates EMA for stable values", () => {
    expect(ema([10, 10, 10, 10, 10], 3)).toBe(10);
  });

  it("returns RSI 100 when there are no losses", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)).toBe(100);
  });
});

describe("decision engine", () => {
  it("buys only on a controlled bullish cross", () => {
    expect(decide(indicatorBase, false).action).toBe("buy");
  });

  it("does not buy when RSI is excessive", () => {
    expect(decide({ ...indicatorBase, rsi: 70 }, false).action).toBe("hold");
  });

  it("sells an open position on bearish cross", () => {
    const signal = decide(
      {
        ...indicatorBase,
        fastEma: 99,
        slowEma: 100,
        previousFastEma: 101,
        previousSlowEma: 100,
      },
      true,
    );
    expect(signal.action).toBe("sell");
  });
});
