import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(process.cwd(), "src");

// El núcleo original sigue siendo la única autoridad persistente. bot-state.ts
// es únicamente una capa que solicita el nonce por el endpoint interno del
// núcleo y nunca calcula uno por su cuenta.
const NONCE_AUTHORITY_FILE = "bot-state-base.ts";
const NONCE_CONSUMER_FILE = "bot-state.ts";
const NONCE_PURE_FUNCTION_FILE = "kraken-nonce.ts";
const PRIVATE_KRAKEN_CALL_SITES = new Set([
  NONCE_AUTHORITY_FILE,
  "live-transport.ts",
  "live-order-preflight.ts",
]);
const PRIVATE_KRAKEN_FUNCTIONS = [
  "fetchApiKeyInfo",
  "fetchBalance",
  "addOrder",
  "cancelOrder",
  "queryOrders",
  "openOrders",
  "closedOrders",
];

function srcFiles(): string[] {
  return readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"));
}

function read(file: string): string {
  return readFileSync(join(SRC_DIR, file), "utf8");
}

describe("Kraken single nonce authority (architectural)", () => {
  it("never constructs a nonce ad-hoc outside the single authority", () => {
    const offenders = srcFiles()
      .filter((file) => file !== NONCE_AUTHORITY_FILE && file !== NONCE_PURE_FUNCTION_FILE)
      .filter((file) => /BigInt\s*\(\s*Date\.now/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("only the single authority calls computeNextNonce", () => {
    const callers = srcFiles().filter((file) =>
      file !== NONCE_PURE_FUNCTION_FILE && /computeNextNonce\s*\(/.test(read(file))
    );
    expect(callers).toEqual([NONCE_AUTHORITY_FILE]);
  });

  it("makes the fee layer consume the internal authority instead of generating a nonce", () => {
    const consumer = read(NONCE_CONSUMER_FILE);
    const feeModule = read("kraken-fees.ts");

    expect(consumer).toContain('super.fetch(new Request("https://bot/kraken/next-nonce"');
    expect(consumer).not.toContain("computeNextNonce");
    expect(feeModule).not.toContain("computeNextNonce");
    expect(feeModule).toMatch(/nonce:\s*string/);
  });

  it("never imports a core private Kraken function outside the authorized call sites", () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      if (PRIVATE_KRAKEN_CALL_SITES.has(file) || file === "kraken.ts") continue;
      const content = read(file);
      const importMatch = content.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\/kraken["']/);
      if (!importMatch) continue;
      const importedNames = importMatch[1]!.split(",").map((name) => name.trim().split(/\s+as\s+/)[0]);
      for (const fn of PRIVATE_KRAKEN_FUNCTIONS) {
        if (importedNames.includes(fn)) offenders.push(`${file}: ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("allows exactly one caller of the TradeVolume audit", () => {
    const callers = srcFiles().filter((file) => {
      const content = read(file);
      return /import\s*\{[^}]*fetchKrakenEffectiveFees[^}]*\}\s*from\s*["']\.\/kraken-fees["']/.test(content);
    });
    expect(callers).toEqual([NONCE_CONSUMER_FILE]);
  });

  it("keeps the extra addOrder call site strictly validate-only", () => {
    const content = read("live-order-preflight.ts");
    expect(content).toMatch(/function\s+forceValidateOnlyOrderRequest/);
    expect(content).toMatch(/validate:\s*true/);
    expect(content).toMatch(/return\s+addOrder\s*\(\s*forceValidateOnlyOrderRequest\(request\)/s);
    expect(content).not.toMatch(/from\s*["']\.\/live-transport["']/);
    expect(content).not.toMatch(/\.createOrder\s*\(/);
  });
});
