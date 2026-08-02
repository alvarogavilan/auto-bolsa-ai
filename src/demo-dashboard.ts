import { standaloneDemoDashboard } from "./demo-dashboard-standalone";
import { DEMO_HISTORY_OUTCOMES_SCRIPT } from "./demo-history-outcomes";
import { DEMO_LIVE_PRICES_SCRIPT } from "./demo-live-prices";

export async function demoDashboard(): Promise<Response> {
  const response = standaloneDemoDashboard();
  let html = await response.text();
  html = html
    .replace("Cuenta equivalente de 50 €, separada del capital técnico multi-estrategia.", "Cuenta equivalente de 50 €; no suma ficticia de nueve carteras.")
    .replace("NO APTO PARA REAL", "NO APTO LIVE")
    .replace("Posiciones abiertas y cerradas", "Posiciones vigentes · Posiciones abiertas y cerradas")
    .replace("Mismo estado contable de Resumen, sin bloques heredados.", "Estado exacto del mismo capital mostrado en Resumen.")
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String")
    .replace("</body>", `${DEMO_HISTORY_OUTCOMES_SCRIPT}${DEMO_LIVE_PRICES_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
