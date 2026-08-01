import { healthDemoDashboard } from "./demo-dashboard-health";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_LABEL_MARKER_MISSING:${search.slice(0, 64)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Aclara la diferencia entre el precio de una unidad completa del activo
 * (por ejemplo, 1 BTC) y el importe realmente utilizado por la orden PAPER.
 * Es una transformación exclusivamente visual: no cambia operaciones,
 * contabilidad, estrategia, riesgo ni habilita LIVE.
 */
export async function labelledDemoDashboard(): Promise<Response> {
  const base = await healthDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "Pulsa cada compra o venta para ver estrategia, importes, comisión, cantidad y estado.",
    "Cada tarjeta separa el precio de 1 unidad del activo del importe real usado en la orden PAPER. Pulsa para ver todos los detalles.",
  );

  html = replaceRequired(
    html,
    "<strong>'+escapeHtml(humanMarket(s.symbol||'XBTEUR'))+' · '+money(price)+'</strong><span>'+escapeHtml(strategyLaneLabel(s.lane))+' · ",
    "<strong>'+escapeHtml(humanMarket(s.symbol||'XBTEUR'))+'</strong><span>Precio por 1 unidad: '+money(price)+'</span><span>'+escapeHtml(strategyLaneLabel(s.lane))+' · ",
  );

  html = replaceRequired(
    html,
    "<strong class=\"'+(pnl===null?'':pnlClass(pnl))+'\">'+(pnl===null?money(netAmount):money(pnl))+'</strong>",
    "<strong class=\"'+(pnl===null?'':pnlClass(pnl))+'\">'+(pnl===null?'Importe: '+money(netAmount):'PnL: '+money(pnl))+'</strong>",
  );

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
