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

  it("keeps the pilot dashboard incapable of submitting or creating orders", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("/api/pilot/prepare");
    expect(html).not.toContain("/api/pilot/preflight");
    expect(html).not.toContain("createOrder");
    expect(html).not.toContain("AddOrder");
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
