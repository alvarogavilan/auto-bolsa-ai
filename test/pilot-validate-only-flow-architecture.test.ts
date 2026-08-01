import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("pilot validate-only flow: architectural guarantees (issue #53)", () => {
  const index = read("src/index.ts");
  const state = read("src/live-executor-state.ts");
  const executor = read("src/live-executor.ts");
  const validation = read("src/pilot-validation.ts");
  const wrangler = read("wrangler.jsonc");

  it("Pruebas obligatorias #6: never reads pair/volume/price/balance/notional from the request body for /prepare-validation", () => {
    const routeStart = state.indexOf('url.pathname === "/prepare-validation"');
    expect(routeStart).toBeGreaterThan(-1);
    const routeEnd = state.indexOf("\n    if (", routeStart + 1);
    const route = state.slice(routeStart, routeEnd === -1 ? undefined : routeEnd);

    expect(route).not.toContain("request.json()");
    expect(route).toContain("buildPilotValidationProposal(this.env)");

    // La única fuente de la propuesta es `buildPilotValidationProposal`, que a
    // su vez solo acepta `env` (ver pilot-validation.ts): ni el par, ni el
    // volumen, ni el precio, ni el saldo, ni el importe pueden llegar del navegador.
    expect(validation).toMatch(/export async function buildPilotValidationProposal\(env: Env\)/);
    expect(validation).not.toMatch(/buildPilotValidationProposal\([^)]*request/);
  });

  it("forwards /api/pilot/prepare-validation to the DO and keeps it behind ADMIN_TOKEN like every other pilot route", () => {
    expect(index).toContain('"/api/pilot/prepare-validation": "/prepare-validation"');

    const pilotBlockStart = index.indexOf('url.pathname.startsWith("/api/pilot")');
    const pilotBlockEnd = index.indexOf('if (request.method === "POST" && url.pathname === "/api/lab/run")');
    const pilotBlock = index.slice(pilotBlockStart, pilotBlockEnd);
    const authCheck = pilotBlock.indexOf("if (!isAuthorized(request, env))");
    const prepareValidationEntry = pilotBlock.indexOf('"/api/pilot/prepare-validation"');
    expect(authCheck).toBeGreaterThan(-1);
    expect(prepareValidationEntry).toBeGreaterThan(authCheck);
  });

  it("keeps /api/pilot/submit permanently blocked and never reachable through the validation flow", () => {
    expect(index).toContain('url.pathname === "/api/pilot/submit"');
    expect(index).toContain("PILOT_SUBMISSION_NOT_ARMED");
    const actionMapStart = index.indexOf("const pilotActions");
    const actionMapEnd = index.indexOf("const target", actionMapStart);
    const actionMap = index.slice(actionMapStart, actionMapEnd);
    expect(actionMap).not.toContain('"/api/pilot/submit"');
    expect(actionMap).toContain('"/api/pilot/prepare-validation": "/prepare-validation"');
  });

  it("Pruebas obligatorias #10: cron still never references the pilot validation flow", () => {
    const scheduled = index.slice(index.indexOf("async scheduled"));
    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
    expect(scheduled).not.toContain("prepare-validation");
    expect(scheduled).not.toContain("prepareValidationOrder");
    expect(scheduled).not.toContain("calibrateLiveBaseline");
    expect(scheduled).not.toContain("buildPilotValidationProposal");
  });

  it("never adds LIVE_TRADING_ENABLED, a new binding, or a new migration to wrangler.jsonc", () => {
    expect(wrangler).not.toContain("LIVE_TRADING_ENABLED");
    expect(wrangler).toContain('"tag": "v3"');
    expect(wrangler).not.toContain('"tag": "v4"');
    const bindings = (wrangler.match(/"name":\s*"[A-Z_]+"/g) ?? []).length;
    expect(bindings).toBe(3); // BOT_STATE, RESEARCH_LAB, LIVE_EXECUTOR: sin bindings nuevos.
  });

  it("prepareValidationOrder only ever forces the guardrail evaluation's copy of liveTradingEnabled, never config itself", () => {
    const fnStart = executor.indexOf("export function prepareValidationOrder");
    const fnBody = executor.slice(fnStart, executor.indexOf("\n}", fnStart));
    expect(fnBody).toContain("ignoreLiveTradingSwitch: true");
    // No debe reasignar ni mutar `config.liveTradingEnabled` directamente.
    expect(fnBody).not.toMatch(/config\.liveTradingEnabled\s*=/);
  });

  it("submitOrder() keeps reading the real liveTradingEnabled untouched, regardless of how the order was prepared", () => {
    const fnStart = executor.indexOf("export async function submitOrder");
    const fnBody = executor.slice(fnStart, executor.indexOf("\nexport ", fnStart + 1));
    expect(fnBody).toContain("if (!config.liveTradingEnabled)");
    expect(fnBody).not.toContain("ignoreLiveTradingSwitch");
  });

  it("certificate and journal displayed in /status use the same storage keys /preflight already writes, so a validation-only order is checked identically", () => {
    expect(state).toContain("livePreflightCertificateStorageKey(order.clOrdId)");
    expect(state).toContain("liveSubmissionJournalStorageKey(order.clOrdId)");
    // El propio /preflight usa la misma clave para persistir el certificado.
    const preflightRoute = state.slice(state.indexOf('url.pathname === "/preflight"'), state.indexOf('url.pathname === "/prepare"'));
    expect(preflightRoute).toContain("livePreflightCertificateStorageKey(order.clOrdId)");
  });

  it("calibration only ever runs against a real, server-confirmed EUR balance, never a client-supplied one", () => {
    const fnStart = executor.indexOf("export function calibrateLiveBaseline");
    const fnBody = executor.slice(fnStart, executor.indexOf("\n}", fnStart));
    expect(fnBody).toContain("input.eurBalance");
    expect(fnBody).not.toMatch(/request\.|body\./);
  });
});
