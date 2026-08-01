import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("inactive LIVE state certified submission architecture", () => {
  const source = read("src/live-executor-state.ts");

  it("preflights only an existing prepared order and reuses its exact clOrdId", () => {
    expect(source).toContain('url.pathname === "/preflight"');
    expect(source).toMatch(/body:\s*\{\s*clOrdId:\s*string\s*\}/);
    expect(source).toMatch(/const order = state\.orders\[body\.clOrdId\]/);
    expect(source).toMatch(/order\.status !== "prepared"/);
    expect(source).toMatch(/clOrdIdFactory:\s*\(\)\s*=>\s*order\.clOrdId/);
  });

  it("invalidates any older certificate and only persists a newly validated certificate", () => {
    expect(source).toMatch(/storage\.delete\(certificateKey\)/);
    expect(source).toMatch(/result\.status === "validated"/);
    expect(source).toMatch(/createLivePreflightCertificate\(intent, result\)/);
    expect(source).toMatch(/storage\.put\(certificateKey, certificate\)/);
    expect(source).toContain("certificatePersisted: certificate !== null");
  });

  it("uses an atomic local certificate store without holding the lock during Kraken transport", () => {
    expect(source).toContain("PersistedAtomicLivePreflightCertificateStore");
    expect(source).toMatch(/blockConcurrencyWhile\(operation\)/);
    const storeMethodEnd = source.indexOf("private async pairResolution");
    const storeSection = source.slice(source.indexOf("private certificateStore"), storeMethodEnd);
    expect(storeSection).not.toContain("this.transport()");
    expect(storeSection).not.toContain("KrakenLiveOrderTransport");
  });

  it("routes every future submit through the certificate gate, never directly through submitOrder", () => {
    expect(source).toContain("submitOrderWithAtomicPreflightCertificate(");
    expect(source).not.toMatch(/\bsubmitOrder\s*\(/);
    expect(source).not.toMatch(/\bsubmitOrder,\s*\n/);
  });

  it("keeps the LIVE class absent from production bindings and exports", () => {
    const wrangler = read("wrangler.jsonc");
    const index = read("src/index.ts");
    expect(wrangler).not.toContain("LIVE_EXECUTOR");
    expect(wrangler).not.toContain("LiveExecutorState");
    expect(index).not.toMatch(/export\s*\{?\s*LiveExecutorState/);
    expect(index).not.toContain('from "./live-executor-state"');
  });
});
