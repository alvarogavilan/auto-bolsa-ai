import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sin __dirname (el repo es ESM): se resuelve relativo al directorio de
// trabajo, que en este repositorio es siempre la raíz al ejecutar `npm test`.
const SRC_DIR = join(process.cwd(), "src");

// Autoridad única del nonce: solo bot-state.ts puede construir un nonce (a
// través de computeNextNonce). Cualquier otro fichero que lo haga directamente
// arriesga desordenar la clave y disparar el bloqueo temporal de Kraken.
const NONCE_AUTHORITY_FILE = "bot-state.ts";
const NONCE_PURE_FUNCTION_FILE = "kraken-nonce.ts";
// Funciones que firman/envían una llamada privada a Kraken. Los únicos puntos
// autorizados son la autoridad existente, el transporte LIVE encapsulado y el
// preflight validate-only aislado. Ninguno calcula el nonce por su cuenta.
const PRIVATE_KRAKEN_CALL_SITES = new Set([
  "bot-state.ts",
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
    const callers = srcFiles().filter((file) => file !== NONCE_PURE_FUNCTION_FILE && /computeNextNonce\s*\(/.test(read(file)));
    expect(callers).toEqual([NONCE_AUTHORITY_FILE]);
  });

  it("never imports a private Kraken function outside the authorized call sites", () => {
    // Se comprueba el import literal desde "./kraken", no el nombre de la
    // llamada: otros módulos tienen sus propios métodos homónimos (p. ej.
    // `LiveOrderTransport.cancelOrder`) que no deben confundirse con la
    // función real de kraken.ts.
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

  it("keeps the extra addOrder call site strictly validate-only", () => {
    const content = read("live-order-preflight.ts");
    expect(content).toMatch(/function\s+forceValidateOnlyOrderRequest/);
    expect(content).toMatch(/validate:\s*true/);
    expect(content).toMatch(/return\s+addOrder\s*\(\s*forceValidateOnlyOrderRequest\(request\)/s);
    expect(content).not.toMatch(/LiveOrderTransport/);
  });
});
