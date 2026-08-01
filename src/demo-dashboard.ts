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
    .replace(
      "a.closed+=n(p.closedTrades);a.wins+=n(p.winningTrades);a.losses+=n(p.losingTrades);",
      "const closed=(Array.isArray(s.trades)?s.trades:[]).filter(t=>t.side==='sell'&&Number.isFinite(Number(t.pnlEur)));a.closed+=closed.length;a.wins+=closed.filter(t=>n(t.pnlEur)>0).length;a.losses+=closed.filter(t=>n(t.pnlEur)<0).length;",
    )
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String");

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
