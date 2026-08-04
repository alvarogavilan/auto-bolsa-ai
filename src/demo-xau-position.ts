import { DEMO_MARKET_UNIVERSE_CODE, DEMO_MARKET_UNIVERSE_STYLE } from "./demo-market-universe";

export const DEMO_XAU_POSITION_STYLE = String.raw`
<style>
#xau-paper-panel{margin:16px 0;padding:16px;border:1px solid #8b6f22;border-radius:16px;background:linear-gradient(135deg,rgba(139,111,34,.18),rgba(21,28,50,.96))}
#xau-paper-panel h2{margin:0 0 10px}#xau-paper-panel .xau-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.xau-metric{padding:10px;border-radius:12px;background:rgba(7,11,24,.58);border:1px solid rgba(255,255,255,.09)}.xau-metric span{display:block;color:#aeb8d4;font-size:12px}.xau-metric strong{display:block;margin-top:4px}.xau-ok{color:#5ee6a8}.xau-warn{color:#ffd86b}.xau-negative{color:#ff8a8a}.xau-note{margin-top:10px;color:#c5cde3;font-size:13px}.xau-live-result{margin:12px 0;padding:14px;border-radius:14px;background:rgba(7,11,24,.76);border:1px solid rgba(255,216,107,.35)}.xau-live-result .headline{font-size:13px;color:#c5cde3}.xau-live-result .amount{font-size:28px;font-weight:800;margin-top:5px}
</style>` + DEMO_MARKET_UNIVERSE_STYLE;

export const DEMO_XAU_POSITION_CODE = String.raw`
(() => {
  const xauFmt = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
  const xauEur = (value) => Number.isFinite(Number(value)) ? xauFmt(value, 4) + ' €' : '—';
  const xauEsc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const xauTime = (value) => Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleTimeString('es-ES') : '—';

  function ensureXauPanel() {
    let panel = document.getElementById('xau-paper-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'xau-paper-panel';
    panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note">Cargando el libro persistido de producción…</div>';
    const positionsNode = document.getElementById('positions');
    const summaryNode = document.getElementById('summary');
    (positionsNode || summaryNode || document.body).prepend(panel);
    return panel;
  }

  function treasuryHtml(treasury) {
    if (!treasury) return '<div class="xau-note xau-warn">Tesorería XAU todavía no disponible.</div>';
    const points = Array.isArray(treasury.equityCurve) ? treasury.equityCurve.length : 0;
    return '<div class="xau-grid">'
      + '<div class="xau-metric"><span>Efectivo XAU</span><strong>'+xauEur(treasury.cashEur)+'</strong></div>'
      + '<div class="xau-metric"><span>Capital comprometido</span><strong>'+xauEur(treasury.committedCapitalEur)+'</strong></div>'
      + '<div class="xau-metric"><span>Equity XAU</span><strong>'+xauEur(treasury.equityEur)+'</strong></div>'
      + '<div class="xau-metric"><span>PnL realizado</span><strong>'+xauEur(treasury.realizedPnlEur)+'</strong></div>'
      + '<div class="xau-metric"><span>Puntos de curva</span><strong>'+xauEsc(points)+'</strong></div>'
      + '<div class="xau-metric"><span>Migración posición previa</span><strong>'+(treasury.migratedExistingPosition?'SÍ':'NO')+'</strong></div>'
      + '</div>';
  }

  function renderXau(status) {
    const panel = ensureXauPanel();
    const book = status && status.positionBook;
    if (!book) {
      panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note xau-warn">El endpoint responde, pero no expone todavía el libro de posiciones.</div>';
      return;
    }
    const open = book.open;
    const metrics = book.metrics || {};
    const treasury = book.treasury || null;
    if (!open) {
      panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note">Sin posición XAU abierta. Cerradas: '+xauEsc(metrics.closed || 0)+' · PnL realizado: '+xauEur(metrics.realizedPnlEur || 0)+'</div>'
        + treasuryHtml(treasury);
      return;
    }
    const pnl = Number(open.unrealizedPnlEur);
    const gross = Number(open.grossUnrealizedPnlEur);
    const costs = Number(open.estimatedRoundTripCostEur);
    const invested = Number(open.budgetEur);
    const currentNetValue = Number.isFinite(invested) && Number.isFinite(pnl) ? invested + pnl : NaN;
    const roiPct = Number.isFinite(invested) && invested > 0 && Number.isFinite(pnl) ? (pnl / invested) * 100 : NaN;
    const pnlClass = pnl >= 0 ? 'xau-ok' : 'xau-negative';
    const grossClass = gross >= 0 ? 'xau-ok' : 'xau-negative';
    const stopMoved = Number.isFinite(Number(open.stopPrice)) && Number.isFinite(Number(open.initialStopPrice)) && Number(open.stopPrice) !== Number(open.initialStopPrice);
    const stopState = open.trailingActive ? 'TRAILING ACTIVO' : (stopMoved ? 'STOP REDUCIDO · AÚN SIN BENEFICIO NETO' : 'STOP INICIAL');
    const stopStateClass = open.trailingActive ? 'xau-ok' : 'xau-warn';
    const tickAgeMs = Number.isFinite(Number(open.lastMarkedAt)) ? Math.max(0, Date.now() - Number(open.lastMarkedAt)) : null;
    const tickClass = tickAgeMs !== null && tickAgeMs <= 15000 ? 'xau-ok' : 'xau-warn';
    panel.innerHTML = '<h2>🟡 XAU/USD · Posición abierta</h2>'
      + '<div class="xau-live-result"><div class="headline">Resultado neto PAPER sobre '+xauEur(invested)+' invertidos</div><div class="amount '+pnlClass+'">'+(pnl>=0?'+':'')+xauEur(pnl)+'</div><div class="xau-note">Bruto: <b class="'+grossClass+'">'+(gross>=0?'+':'')+xauEur(gross)+'</b> · Costes estimados: <b>'+xauEur(costs)+'</b> · Neto: <b class="'+pnlClass+'">'+(pnl>=0?'+':'')+xauEur(pnl)+'</b></div><div class="xau-note">Valor neto actual: <b>'+xauEur(currentNetValue)+'</b> · Rentabilidad neta: <b class="'+pnlClass+'">'+(roiPct>=0?'+':'')+xauFmt(roiPct,3)+' %</b></div></div>'
      + '<div class="xau-grid">'
      + '<div class="xau-metric"><span>Dinero invertido</span><strong>'+xauEur(invested)+'</strong></div>'
      + '<div class="xau-metric"><span>Beneficio bruto</span><strong class="'+grossClass+'">'+(gross>=0?'+':'')+xauEur(gross)+'</strong></div>'
      + '<div class="xau-metric"><span>Costes estimados</span><strong>'+xauEur(costs)+'</strong></div>'
      + '<div class="xau-metric"><span>Ganancia / pérdida neta</span><strong class="'+pnlClass+'">'+(pnl>=0?'+':'')+xauEur(pnl)+'</strong></div>'
      + '<div class="xau-metric"><span>Valor neto actual</span><strong class="'+pnlClass+'">'+xauEur(currentNetValue)+'</strong></div>'
      + '<div class="xau-metric"><span>Break-even neto</span><strong>'+xauFmt(open.netBreakEvenPrice, 6)+'</strong></div>'
      + '<div class="xau-metric"><span>Dirección</span><strong>'+xauEsc(String(open.side || '').toUpperCase())+'</strong></div>'
      + '<div class="xau-metric"><span>Entrada</span><strong>'+xauFmt(open.entryPrice, 2)+'</strong></div>'
      + '<div class="xau-metric"><span>Precio actual de salida</span><strong class="'+tickClass+'">'+xauFmt(open.lastMarkPrice, 4)+'</strong></div>'
      + '<div class="xau-metric"><span>Último tick</span><strong class="'+tickClass+'">'+xauTime(open.lastMarkedAt)+'</strong></div>'
      + '<div class="xau-metric"><span>Stop actual</span><strong>'+xauFmt(open.stopPrice, 6)+'</strong></div>'
      + '<div class="xau-metric"><span>Estado del stop</span><strong class="'+stopStateClass+'">'+stopState+'</strong></div>'
      + '<div class="xau-metric"><span>Objetivo</span><strong>'+xauFmt(open.targetPrice, 6)+'</strong></div>'
      + '<div class="xau-metric"><span>Beneficio neto protegido</span><strong>'+xauEur(open.protectedPnlEur)+'</strong></div>'
      + '</div>'
      + '<div class="xau-note"><b>Tesorería XAU persistida</b></div>'
      + treasuryHtml(treasury)
      + '<div class="xau-note">Una SELL puede tener beneficio bruto y resultado neto negativo mientras los costes estimados no estén cubiertos. El stop reducido conserva la mejora de riesgo heredada, pero no se presenta como beneficio protegido. LIVE y órdenes reales desactivados.</div>';
  }

  async function refreshXau() {
    try {
      const response = await fetch('/api/xau/status', {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP '+response.status);
      renderXau(await response.json());
    } catch (error) {
      const panel = ensureXauPanel();
      panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note xau-negative">No se pudo leer el estado XAU: '+xauEsc(error && error.message ? error.message : error)+'</div>';
    }
  }

  refreshXau();
  setInterval(refreshXau, 1000);
})();` + DEMO_MARKET_UNIVERSE_CODE;
