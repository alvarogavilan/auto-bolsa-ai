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

  it("blocks a new preflight when a write-ahead intent is still unresolved", () => {
    expect(source).toContain("this.submissionJournal().recoveryDecision(order.clOrdId)");
    expect(source).toMatch(/recovery\.action === "reconcile_only"/);
    expect(source).toMatch(/se exige reconciliación y nunca un nuevo preflight/);
    const recoveryCheck = source.indexOf("recoveryDecision(order.clOrdId)");
    const gatewayCreation = source.indexOf("new KrakenValidateOnlyOrderGateway");
    expect(recoveryCheck).toBeGreaterThan(0);
    expect(gatewayCreation).toBeGreaterThan(recoveryCheck);
  });

  it("invalidates any older certificate and only persists a newly validated certificate", () => {
    expect(source).toMatch(/storage\.delete\(certificateKey\)/);
    expect(source).toMatch(/result\.status === "validated"/);
    expect(source).toMatch(/createLivePreflightCertificate\(intent, result\)/);
    expect(source).toMatch(/storage\.put\(certificateKey, certificate\)/);
    expect(source).toContain("certificatePersisted: certificate !== null");
  });

  it("uses atomic local stores without holding their locks during Kraken transport", () => {
    expect(source).toContain("PersistedAtomicLivePreflightCertificateStore");
    expect(source).toContain("PersistedLiveSubmissionJournal");
    expect(source).toMatch(/blockConcurrencyWhile\(operation\)/);
    const storeMethodEnd = source.indexOf("private async resolveVerifiedJournals");
    const storeSection = source.slice(source.indexOf("private certificateStore"), storeMethodEnd);
    expect(storeSection).not.toContain("this.transport()");
    expect(storeSection).not.toContain("KrakenLiveOrderTransport");
  });

  it("routes every internal submit through certificate and journal gates", () => {
    expect(source).toContain("submitOrderWithAtomicPreflightCertificate(");
    expect(source).toContain("this.certificateStore()");
    expect(source).toContain("this.submissionJournal()");
    expect(source).not.toMatch(/\bsubmitOrder\s*\(/);
    expect(source).not.toMatch(/\bsubmitOrder,\s*\n/);
  });

  it("marks journals reconciled only after a verified reconciliation report", () => {
    expect(source).toContain("private async resolveVerifiedJournals");
    expect(source).toMatch(/if \(!reportOk\) return \[\]/);
    expect(source).toMatch(/report\.ok,\s*\n\s*report\.unresolvedOrders/);
    expect(source).toContain("journal.markReconciled(order.clOrdId, now)");
    expect(source).toContain("reconciledJournals");
  });

  it("deploys persistent pilot state while keeping public submission impossible", () => {
    const wrangler = read("wrangler.jsonc");
    const wrapper = read("src/index.ts");
    const indexCore = read("src/index-core.ts");

    expect(wrangler).toContain('"name": "LIVE_EXECUTOR"');
    expect(wrangler).toContain('"class_name": "LiveExecutorState"');
    expect(wrangler).toContain('"tag": "v3"');
    expect(wrangler).not.toContain("LIVE_TRADING_ENABLED");

    expect(indexCore).toContain('from "./live-executor-state"');
    expect(wrapper).toMatch(/export\s*\{[^}]*LiveExecutorState/s);
    expect(indexCore).toContain('url.pathname === "/api/pilot/submit"');
    expect(indexCore).toContain("PILOT_SUBMISSION_NOT_ARMED");

    const actionMapStart = indexCore.indexOf("const pilotActions");
    const actionMapEnd = indexCore.indexOf("const target", actionMapStart);
    const actionMap = indexCore.slice(actionMapStart, actionMapEnd);
    expect(actionMap).not.toContain('"/api/pilot/submit"');

    const scheduled = indexCore.slice(indexCore.indexOf("async scheduled"));
    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
    expect(wrapper).toContain("return coreWorker.scheduled(controller, env, ctx)");
  });
});
