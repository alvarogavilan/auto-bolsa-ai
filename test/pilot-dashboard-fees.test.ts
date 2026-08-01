import { describe, expect, it } from "vitest";
import { authenticatedPilotDashboard } from "../src/pilot-dashboard-access";

describe("effective Kraken fees in pilot dashboard", () => {
  it("renders account balance, maker, taker and 30-day volume", async () => {
    const response = await authenticatedPilotDashboard();
    const html = await response.text();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(html).toContain("Tarifas efectivas de Kraken");
    expect(html).toContain("Saldo EUR");
    expect(html).toContain("Taker");
    expect(html).toContain("Maker");
    expect(html).toContain("Volumen 30 días");
    expect(html).toContain("Lectura privada de la cuenta");
  });

  it("loads fees from the existing authenticated connection endpoint", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("fetch('/api/kraken/connection'");
    expect(html).toContain("Authorization:'Bearer '+token");
    expect(html).toContain("cache:'no-store'");
    expect(html).toContain("loadEffectiveFees");
    expect(html).not.toMatch(/[?&](token|admin_token)=/i);
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("document.cookie");
  });

  it("compares the effective taker fee with the frozen PAPER assumption", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("paperFeeMatchesCurrentTaker");
    expect(html).toContain("assumedPaperFeeEachSidePct");
    expect(html).toContain("La cohorte forward permanece congelada");
    expect(html).toContain("No se cambiará retroactivamente");
    expect(html).toContain("una cohorte separada");
  });

  it("keeps a fee-audit failure informational and does not disable Kraken authentication", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).toContain("La conexión Kraken funciona, pero la auditoría de tarifas no está disponible");
    expect(html).toContain("effectiveFeesStatus");
    expect(html).toContain("No disponible");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await authenticatedPilotDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
    expect(match?.[1]).not.toMatch(/^\+/m);
  });

  it("contains no order-submission or live activation control", async () => {
    const html = await (await authenticatedPilotDashboard()).text();

    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
    expect(html).not.toContain("AddOrder");
    expect(html).not.toContain("createOrder");
    expect(html).not.toContain("Enviar orden real");
  });
});
