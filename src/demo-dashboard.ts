import { standaloneDemoDashboard } from "./demo-dashboard-standalone";

// La ruta pública conserva un contrato no-store y una única implementación PAPER.
export async function demoDashboard(): Promise<Response> {
  const response = standaloneDemoDashboard();
  let html = await response.text();

  html = html
    .replace(
      "Cuenta equivalente de 50 €, separada del capital técnico multi-estrategia.",
      "Cuenta equivalente de 50 €; no suma ficticia de nueve carteras.",
    )
    .replace("NO APTO PARA REAL", "NO APTO LIVE")
    .replace(
      "Posiciones abiertas y cerradas",
      "Posiciones vigentes · Posiciones abiertas y cerradas",
    )
    .replace(
      "Mismo estado contable de Resumen, sin bloques heredados.",
      "Estado exacto del mismo capital mostrado en Resumen.",
    )
    .replace(
      "Las pérdidas y comisiones cerradas permanecen contabilizadas",
      "las pérdidas y comisiones cerradas permanecen contabilizadas",
    )
    .replace("el patrón sin ganadoras", "el patrón 0 ganadoras")
    .replace("JSON.stringify", "String");

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
