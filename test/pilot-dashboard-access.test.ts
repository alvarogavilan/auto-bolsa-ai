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

  it("authenticates every private call with a bearer header and never places the token in a URL", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("Authorization:'Bearer '+token");
    expect(html).toContain("fetch('/api/pilot/readiness'");
    expect(html).not.toMatch(/[?&](token|admin_token)=/i);
    expect(html).not.toContain("window.location.search");
    expect(html).not.toContain("document.cookie");
  });

  it("refreshes Kraken safety checks automatically after saving a token", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("refreshPilotSafetyChecks");
    expect(html).toContain("authenticatedPilotPost('/api/pilot/refresh-kraken')");
    expect(html).toContain("Conexión, saldo y permisos de Kraken actualizados");
    expect(html).toContain("PILOT_SAFE_REFRESH_KEY");
    expect(html).toContain("await refreshPilotSafetyChecks()");
  });

  it("forgets invalid credentials and prepared ids beyond the current tab", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("response.status===401");
    expect(html).toContain("sessionStorage.removeItem(PILOT_TOKEN_KEY)");
    expect(html).toContain("sessionStorage.removeItem(PILOT_CL_ORD_ID_KEY)");
    expect(html).toContain("sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY)");
    expect(html).toContain("Olvidar token");
  });

  it("offers only server-built preparation and validate=true without any submit path", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("Paso 1 · Preparar validación de hasta 5 €");
    expect(html).toContain("Paso 2 · Validar en Kraken — no enviar");
    expect(html).toContain("/api/pilot/prepare-validation");
    expect(html).toContain("/api/pilot/preflight");
    expect(html).toContain("window.confirm");
    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("createOrder");
    expect(html).not.toContain("AddOrder");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
  });

  it("explains that PAPER blocks real money but not validate-only", async () => {
    const html = await (await authenticatedPilotDashboard()).text();
    expect(html).toContain("los bloqueos PAPER pueden impedir un piloto con dinero real");
    expect(html).toContain("no impiden completar esta validación técnica sin envío");
  });

  it("does not accept browser fields for pair, price, volume, balance or amount", async () => {
    const html = await (await authenticatedPilotDashboard()).text();
    expect(html).not.toMatch(/id="(pair|price|volume|balance|amount|notional)"/i);
    expect(html).toContain("authenticatedPilotPost('/api/pilot/prepare-validation')");
  });

  it("shows the preflight button only after receiving a prepared clOrdId", async () => {
    const html = await (await authenticatedPilotDashboard()).text();
    expect(html).toContain('id="runPreflightButton"');
    expect(html).toContain("style=\"display:none\"");
    expect(html).toContain("sessionStorage.setItem(PILOT_CL_ORD_ID_KEY,clOrdId)");
    expect(html).toContain("document.getElementById('runPreflightButton').style.display=clOrdId?'inline-block':'none'");
  });

  it("connects /pilot and preserves permanent submission blocks", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(index).toContain('url.pathname === "/pilot"');
    expect(index).toContain("return authenticatedPilotDashboard()");
    expect(index).toContain('url.pathname === "/api/pilot/prepare-validation"');
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
