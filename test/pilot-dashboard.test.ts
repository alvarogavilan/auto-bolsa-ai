import { describe, expect, it } from "vitest";
import { pilotDashboard } from "../src/pilot-dashboard";

async function html(): Promise<string> {
  return (await pilotDashboard()).text();
}

describe("pilot dashboard (read-only)", () => {
  it("returns mobile-first HTML with Cache-Control: no-store", async () => {
    const response = await pilotDashboard();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain('name="viewport" content="width=device-width,initial-scale=1');
  });

  it("fetches from /api/pilot/readiness and from nothing else", async () => {
    const body = await html();
    expect(body).toContain("fetch('/api/pilot/readiness'");
    expect((body.match(/fetch\(/g) ?? []).length).toBe(1);
  });

  it("contains every required section", async () => {
    const body = await html();
    const requiredSections = [
      "Estado general",
      "Bloqueadores",
      "Avisos",
      "Comprobaciones superadas",
      "Evidencia PAPER",
      "Conexión Kraken",
      "Comisiones efectivas Kraken",
      "Mercado seleccionado",
      "Orden preparada",
      "Certificado de preflight",
      "Journal de envío",
      "Reconciliación",
      "Emergencia y liquidación manual",
    ];
    for (const section of requiredSections) expect(body).toContain(section);
  });

  it("covers every PAPER metric required by the issue", async () => {
    const body = await html();
    expect(body).toContain("Días observados");
    expect(body).toContain("Velas cerradas únicas");
    expect(body).toContain("Operaciones cerradas");
    expect(body).toContain("PnL neto");
    expect(body).toContain("Profit factor");
    expect(body).toContain("Drawdown máximo");
    expect(body).toContain("Tasa de error");
  });

  it("covers Kraken connection, fees, safe permissions and EUR balance without exposing sensitive fields", async () => {
    const body = await html();
    expect(body).toContain("krakenConnection");
    expect(body).toContain("krakenPermissions");
    expect(body).toContain("Saldo EUR");
    expect(body).toContain("Maker efectivo");
    expect(body).toContain("Taker efectivo");
    expect(body).toContain("Coste ida y vuelta sobre 5 €");
    expect(body).toContain("renderKrakenFees");
    expect(body).not.toMatch(/apiKeyName/i);
    expect(body).not.toMatch(/api[_-]?secret/i);
    expect(body).not.toContain("withdrawalPermission");
    expect(body).not.toContain("depositPermission");
    expect(body).not.toContain("earnPermission");
  });

  it("covers market selection: pair, minimum, precision, spread and freshness", async () => {
    const body = await html();
    expect(body).toContain("marketPair");
    expect(body).toContain("Mínimo de orden");
    expect(body).toContain("Precisión");
    expect(body).toContain("Spread");
    expect(body).toContain("Frescura");
  });

  it("covers the prepared order: side, pair, type, volume, price and the 5 EUR cap", async () => {
    const body = await html();
    expect(body).toContain("Lado");
    expect(body).toContain(">Par<");
    expect(body).toContain("Tipo");
    expect(body).toContain("Volumen");
    expect(body).toContain("Precio");
    expect(body).toContain("máx. 5");
  });

  it("covers every preflight certificate status required by the issue", async () => {
    const body = await html();
    expect(body).toContain("absent:'Ausente'");
    expect(body).toContain("valid:'Válido'");
    expect(body).toContain("expired:'Caducado'");
    expect(body).toContain("consumed:'Consumido'");
    expect(body).toContain("invalid:'Inválido'");
  });

  it("covers every submission journal phase required by the issue", async () => {
    const body = await html();
    expect(body).toContain("none:'Sin entrada (none)'");
    expect(body).toContain("intent_persisted:'Intención persistida'");
    expect(body).toContain("transport_outcome_recorded:'Desenlace de transporte registrado'");
    expect(body).toContain("reconciled:'Reconciliado'");
  });

  it("covers reconciliation of orders, fills and balances", async () => {
    const body = await html();
    expect(body).toContain("function renderReconciliation");
    expect(body).toContain("Balance:");
  });

  it("covers emergency stop and pending manual liquidation", async () => {
    const body = await html();
    expect(body).toContain("Parada de emergencia");
    expect(body).toContain("Liquidación manual pendiente");
  });

  it("states unambiguously that the screen never sends or activates trading", async () => {
    const body = await html();
    expect(body).toMatch(/nunca envía órdenes/i);
    expect(body).toMatch(/nunca activa el trading real/i);
    expect(body).toContain("No crea órdenes");
    expect(body).toContain("no cambia automáticamente los parámetros");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const body = await html();
    const script = body.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it("never promises profit or guaranteed results", async () => {
    const body = await html();
    expect(body).not.toMatch(/garantiza(do)?\s+(un\s+)?beneficio/i);
    expect(body).not.toMatch(/beneficio\s+garantizado/i);
  });

  it("never references /api/live, order-creation functions, LIVE_TRADING_ENABLED, or secrets", async () => {
    const body = await html();
    expect(body).not.toContain("/api/live");
    expect(body).not.toContain("createOrder");
    expect(body).not.toContain("AddOrder");
    expect(body).not.toContain("LIVE_TRADING_ENABLED");
    expect(body).not.toMatch(/ADMIN_TOKEN/);
    expect(body).not.toMatch(/api[_-]?key/i);
    expect(body).not.toMatch(/api[_-]?secret/i);
  });

  it("never contains a submit button or any call that could send an order", async () => {
    const body = await html();
    expect(body).not.toMatch(/onclick="[^"]*submit/i);
    expect(body).not.toContain("/api/pilot/submit");
    expect(body).not.toContain("/api/pilot/prepare");
    expect(body).not.toContain("/api/pilot/preflight");
  });

  it("gives visual representation to the blocked, eligible and previous-cycle-verified states", async () => {
    const body = await html();
    expect(body).toContain("function overallStatus");
    expect(body).toContain("blocked:['Bloqueado'");
    expect(body).toContain("eligible:['Elegible para revisión'");
    expect(body).toContain("previous_cycle_verified:['Ciclo anterior verificado'");
    expect(body).toContain("preparing:['Preparando'");
  });

  it("never crashes rendering: every accessor is defensive against a missing or evolving schema", async () => {
    const body = await html();
    expect(body).toContain("function pick(");
    expect(body).toContain("No disponible");
  });
});
