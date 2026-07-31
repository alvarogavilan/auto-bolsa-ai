import { describe, expect, it } from "vitest";
import { computeNextNonce } from "../src/kraken-nonce";

describe("Kraken nonce: single authority", () => {
  it("always advances strictly beyond the last issued nonce, even if the clock has not moved", () => {
    const first = computeNextNonce(0n, 1_700_000_000_000);
    const second = computeNextNonce(first, 1_700_000_000_000);
    const third = computeNextNonce(second, 1_700_000_000_000);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("stays monotonic across two callers sharing one authority, interleaved in any order", () => {
    // Simula LiveExecutorState y BotState pidiendo nonces a la misma autoridad
    // (un único contador persistente) en vez de mantener cada uno el suyo.
    let lastNonce = 0n;
    const issued: bigint[] = [];
    const callers = [1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_001, 1_700_000_000_000, 1_700_000_000_002];
    for (const now of callers) {
      lastNonce = computeNextNonce(lastNonce, now);
      issued.push(lastNonce);
    }
    for (let i = 1; i < issued.length; i += 1) {
      expect(issued[i]!).toBeGreaterThan(issued[i - 1]!);
    }
  });

  it("would NOT stay monotonic if two independent counters raced from the same starting point", () => {
    // Documenta el bug que motivó centralizar el nonce: dos contadores
    // independientes que arrancan del mismo punto pueden emitir el mismo
    // valor, o incluso desordenado si el reloj no ha avanzado entre ambos.
    const counterA = computeNextNonce(0n, 1_700_000_000_000);
    const counterB = computeNextNonce(0n, 1_700_000_000_000);
    expect(counterA).toBe(counterB);
  });
});
