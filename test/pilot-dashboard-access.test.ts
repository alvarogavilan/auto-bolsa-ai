import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authenticatedPilotDashboard } from "../src/pilot-dashboard-access";

const ROOT = process.cwd();

describe("authenticated pilot dashboard route", () => {
  it("adds a private session-only token form to the read-only dashboard", async () => {
    const response = await authenticatedPilotDashboard();
    const html = await response.text();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(html).toContain("Acceso privado");
    expect(html).toContain('type="password"');
    expect(html).toContain("sessionStorage");
    expect(html).not.toContain("localStorage");
  });

  it("authenticates readiness with a bearer header and never places the token in a URL", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("Authorization:'Bearer '+token");
    expect(html).toContain("fetch('/api/pilot/readiness'");
    expect(html).not.toMatch(/[?&](token|admin_token)=/i);
    expect(html).not.toContain("window.location.search");
    expect(html).not.toContain("document.cookie");
  });

  it("forgets invalid credentials and does not persist them beyond the current tab", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("response.status===401");
    expect(html).toContain("sessionStorage.removeItem(PILOT_TOKEN_KEY)");
    expect(html).toContain("Olvidar token");
  });

  it("keeps the pilot dashboard incapable of submitting or creating a real order", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).not.toContain("/api/pilot/submit");
    // El único "prepare" permitido es el de validación; el endpoint real
    // /api/pilot/prepare (sin "-validation") nunca debe aparecer aquí.
    expect(html).not.toMatch(/\/api\/pilot\/prepare(?!-validation)/);
    expect(html).not.toContain("createOrder");
    expect(html).not.toContain("AddOrder");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
    expect(html).not.toMatch(/\/api\/live\b/);
  });

  it("adds exactly the two validation actions required by the pilot flow", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("Preparar validación de hasta 5 €");
    expect(html).toContain("Validar en Kraken — no enviar");
    expect(html).toContain("pilotAuthorizedPost('/api/pilot/prepare-validation')");
    expect(html).toContain("pilotAuthorizedPost('/api/pilot/preflight'");
  });

  it("confirms with the user before either validation action runs", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toMatch(/confirm\('[^']*'\)\)return;\s*setPilotValidationStatus\('Preparando/);
    expect(html).toMatch(/confirm\('[^']*'\)\)return;\s*setPilotValidationStatus\('Validando/);
  });

  it("hides the validate button until a clOrdId has been prepared, and never accepts free-form economic input", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain('id="pilotValidateButton" class="small secondary" style="display:none"');
    expect(html).toContain("pilotPreparedClOrdId=null");
    expect(html).toMatch(/if\(!pilotPreparedClOrdId\)/);
    // Ninguna de las dos acciones lee un input de texto: solo hay un botón por acción.
    expect(html).not.toMatch(/<input[^>]*id="pilot(Pair|Volume|Price|Balance|Notional)/i);
    expect((html.match(/onclick="(preparePilotValidation|validatePilotOrder)\(\)"/g) ?? []).length).toBe(2);
  });

  it("refreshes /api/pilot/readiness after each validation action", async () => {
    const html = await (await authenticatedPilotDashboard()).text();
    const prepareFn = html.slice(html.indexOf("async function preparePilotValidation"), html.indexOf("async function validatePilotOrder"));
    const validateFn = html.slice(html.indexOf("async function validatePilotOrder"));

    expect(prepareFn).toContain("loadPilot(true)");
    expect(validateFn.slice(0, validateFn.indexOf("\n  }\n"))).toContain("loadPilot(true)");
  });

  it("connects only GET /pilot while preserving hard-disabled submission routes", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(index).toContain('url.pathname === "/pilot"');
    expect(index).toContain("return authenticatedPilotDashboard()");
    expect(index).toContain('url.pathname === "/api/pilot/submit"');
    expect(index).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(index).toContain('url.pathname.startsWith("/api/live")');
    expect(index).toContain("LIVE_TRADING_HARD_DISABLED");
  });

  it("does not add the pilot runtime to scheduled execution", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const scheduled = index.slice(index.indexOf("async scheduled"));

    expect(scheduled).not.toContain("liveExecutorState(");
    expect(scheduled).not.toContain("/api/pilot");
    expect(scheduled).not.toContain("authenticatedPilotDashboard");
  });
});
