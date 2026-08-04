import { DEMO_MARKET_UNIVERSE_CODE, DEMO_MARKET_UNIVERSE_STYLE } from "./demo-market-universe";

export const DEMO_XAU_POSITION_STYLE = String.raw`
<style>
#xau-paper-panel{margin:16px 0;padding:16px;border:1px solid #8b6f22;border-radius:16px;background:linear-gradient(135deg,rgba(139,111,34,.18),rgba(21,28,50,.96))}
#xau-paper-panel h2{margin:0 0 10px}#xau-paper-panel .xau-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.xau-metric{padding:10px;border-radius:12px;background:rgba(7,11,24,.58);border:1px solid rgba(255,255,255,.09)}.xau-metric span{display:block;color:#aeb8d4;font-size:12px}.xau-metric strong{display:block;margin-top:4px}.xau-ok{color:#5ee6a8}.xau-warn{color:#ffd86b}.xau-negative{color:#ff8a8a}.xau-note{margin-top:10px;color:#c5cde3;font-size:13px}
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

  function renderXau(status) {
    const panel = ensureXauPanel();
    const book = status && status.positionBook;
    if (!book) {
      panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note xau-warn">El endpoint responde, pero no expone todavía el libro de posiciones.</div>';
      return;
    }
    const open = book.open;
    const metrics = book.metrics || {};
    if (!open) {
      panel.innerHTML = '<h2>🟡 XAU/USD · Operación PAPER</h2><div class="xau-note">Sin posición XAU abierta. Cerradas: '+xauEsc(metrics.closed || 0)+' · PnL realizado: '+xauEur(metrics.realizedPnlEur || 0)+'</div>';
      return;
    }
    const pnlClass = Number(open.unrealizedPnlEur) >= 0 ? 'xau-ok' : 'xau-negative';
    const tickAgeMs = Number.isFinite(Number(open.lastMarkedAt)) ? Math.max(0, Date.now() - Number(open.lastMarkedAt)) : null;
    const tickClass = tickAgeMs !== null && tickAgeMs <= 15000 ? 'xau-ok' : 'xau-warn';
    panel.innerHTML = '<h2>🟡 XAU/USD · Posición abierta</h2>'
      + '<div class="xau-grid">'
      + '<div class="xau-metric"><span>Dirección</span><strong>'+xauEsc(String(open.side || '').toUpperCase())+'</strong></div>'
      + '<div class="xau-metric"><span>Entrada</span><strong>'+xauFmt(open.entryPrice, 2)+'</strong></div>'
      + '<div class="xau-metric"><span>Precio actual de salida</span><strong class="'+tickClass+'">'+xauFmt(open.lastMarkPrice, 4)+'</strong></div>'
      + '<div class="xau-metric"><span>Último tick</span><strong class="'+tickClass+'">'+xauTime(open.lastMarkedAt)+'</strong></div>'
      + '<div class="xau-metric"><span>Stop actual</span><strong>'+xauFmt(open.stopPrice, 6)+'</strong></div>'
      + '<div class="xau-metric"><span>Objetivo</span><strong>'+xauFmt(open.targetPrice, 6)+'</strong></div>'
      + '<div class="xau-metric"><span>PnL no realizado</span><strong class="'+pnlClass+'">'+xauEur(open.unrealizedPnlEur)+'</strong></div>'
      + '<div class="xau-metric"><span>Trailing</span><strong class="'+(open.trailingActive?'xau-ok':'xau-warn')+'">'+(open.trailingActive?'ACTIVO':'AÚN NO')+'</strong></div>'
      + '<div class="xau-metric"><span>Beneficio protegido</span><strong>'+xauEur(open.protectedPnlEur)+'</strong></div>'
      + '<div class="xau-metric"><span>Capital PAPER</span><strong>'+xauEur(open.budgetEur)+'</strong></div>'
      + '</div>'
      + '<div class="xau-note">El precio y el PnL proceden del último marcado persistido del motor; la tarjeta consulta producción cada 2,5 s. LIVE y órdenes reales desactivados.</div>';
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
  setInterval(refreshXau, 2500);
})();` + DEMO_MARKET_UNIVERSE_CODE;
