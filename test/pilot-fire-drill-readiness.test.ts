import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fireDrillPilotDashboard } from "../src/pilot-dashboard-fire-drill";
import { enrichReadinessWithFireDrill } from "../src/pilot-fire-drill-readiness";

const ROOT = process.cwd();

describe("pilot fire drill readiness gate", () => {
  it("keeps an eligible report eligible only after all six checks pass", async () => {
    const response = await enrichReadinessWithFireDrill(Response.json({
      blockers: [],
      warnings: [],
      passedChecks: ["Base lista"],
      infrastructureEligibleForManualReview: true,
      liveTrading: false,
    }));
    const body = await response.json<Record<string, unknown>>();
    const fireDrill = body.fireDrill as Record<string, unknown>;

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fireDrill.passed).toBe(true);
    expect(fireDrill.passedChecks).toBe(6);
    expect(body.infrastructureEligibleForManualReview).toBe(true);
    expect(body.liveTrading).toBe(false);
    expect(body.passedChecks).toContain("Simulacro integral superado: 6/6");
  });

  it("never upgrades a report that was already blocked", async () => {
    const response = await enrichReadinessWithFireDrill(Response.json({
      blockers: ["PAPER pendiente"],
      passedChecks: [],
      infrastructureEligibleForManualReview: false,
      liveTrading: false,
    }));
    const body = await response.json<Record<string, unknown>>();

    expect(body.infrastructureEligibleForManualReview).toBe(false);
    expect(body.blockers).toEqual(["PAPER pendiente"]);
    expect(body.message).toBe("Piloto todavía bloqueado por 1 condición(es).");
  });

  it("does not transform authentication failures", async () => {
    const original = new Response("Unauthorized", { status: 401 });
    const response = await enrichReadinessWithFireDrill(original);

    expect(response).toBe(original);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("renders the automatic report and keeps the manual rerun available", async () => {
    const html = await (await fireDrillPilotDashboard()).text();

    expect(html).toContain("renderPilotFireDrill(data.fireDrill)");
    expect(html).toContain("El informe de preparación las ejecutará automáticamente");
    expect(html).toContain("Ejecutar 6 pruebas de seguridad");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("intercepts only readiness and refresh while preserving the original Worker", () => {
    const adapter = readFileSync(join(ROOT, "src/index-fire-drill.ts"), "utf8");
    const core = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(adapter).toContain('url.pathname === "/api/pilot/readiness"');
    expect(adapter).toContain('url.pathname === "/api/pilot/refresh-kraken"');
    expect(adapter).toContain("enrichReadinessWithFireDrill(await coreWorker.fetch(request, env))");
    expect(core).toContain("PILOT_SUBMISSION_NOT_ARMED");
    expect(core).toContain("LIVE_TRADING_HARD_DISABLED");
  });
});
