export const DEMO_HISTORY_EVIDENCE_INTEGRITY_CODE = String.raw`
(() => {
  const retainedTradeRows = () => typeof trades === 'function' ? trades() : [];

  function fallbackTradeCard(row) {
    const strategy = row.s || {};
    const trade = row.t || {};
    const buy = trade.side === 'buy';
    const gross = n(trade.grossEur);
    const fee = n(trade.feeEur);
    const net = buy ? gross + fee : gross - fee;
    return '<details class="item history-fallback-card">'
      + '<summary><div class="order-head"><span class="side ' + (buy ? 'buy' : 'sell') + '">'
      + (buy ? 'COMPRA' : 'VENTA') + '</span><div><b>' + esc(strategy.symbol || strategy.id || 'Operación PAPER')
      + '</b><div class="sub">' + esc(strategy.id || 'estrategia no identificada') + ' · ' + lane(strategy.lane)
      + ' · ' + esc(trade.reason || 'Motivo no conservado') + '</div></div><time class="sub">' + dt(trade.timestamp)
      + '</time></div></summary><div class="kvs">'
      + kv('Precio unitario', eur(trade.price))
      + kv('Cantidad', String(trade.quantity ?? '—'))
      + kv('Importe bruto', eur(gross))
      + kv('Comisión', eur(fee), 'negative')
      + kv(buy ? 'Total descontado' : 'Neto recibido', eur(net))
      + kv('PnL neto', typeof trade.pnlEur === 'number' ? eur(trade.pnlEur) : 'Posición abierta', typeof trade.pnlEur === 'number' ? cls(trade.pnlEur) : '')
      + kv('Carril', lane(strategy.lane))
      + kv('ID', esc(trade.id || 'sin-id'))
      + kv('Timestamp', dt(trade.timestamp))
      + kv('Explicación persistida', esc(trade.reason || 'Sin explicación persistida'))
      + '</div></details>';
  }

  const baseRenderHistory = typeof renderHistory === 'function' ? renderHistory : null;
  if (baseRenderHistory) {
    renderHistory = function renderHistoryFromRetainedTrades() {
      baseRenderHistory();
      const rows = retainedTradeRows();
      if (!rows.length) return;
      const cards = history.querySelectorAll('details.item');
      if (cards.length === rows.length) return;
      history.innerHTML = '<div class="head"><div><h2>Historial completo</h2><div class="muted">'
        + rows.length + ' órdenes reconstruidas directamente desde state.strategies[].trades.</div></div></div>'
        + '<div class="banner warn"><b>Recuperación de integridad:</b> la vista principal no representó todos los movimientos; se usa el historial retenido como fuente directa.</div>'
        + '<div class="list">' + rows.map(fallbackTradeCard).join('') + '</div>';
    };
  }

  const baseRenderPaperEvidence = typeof renderPaperEvidence === 'function' ? renderPaperEvidence : null;
  if (baseRenderPaperEvidence) {
    renderPaperEvidence = function renderPaperEvidenceWithTradeFallback() {
      const report = lab && lab.paperEvidenceLedger ? lab.paperEvidenceLedger : null;
      const rows = retainedTradeRows();
      if (report) return baseRenderPaperEvidence();
      if (!rows.length) return baseRenderPaperEvidence();
      const buys = rows.filter(row => row.t && row.t.side === 'buy').length;
      const sells = rows.filter(row => row.t && row.t.side === 'sell').length;
      const closed = rows.filter(row => row.t && row.t.side === 'sell' && typeof row.t.pnlEur === 'number');
      const pnl = closed.reduce((sum, row) => sum + n(row.t.pnlEur), 0);
      const recent = rows.slice(0, 8);
      return '<article class="item"><h3 class="mini-title">Archivo de evidencia PAPER</h3>'
        + '<div class="sub">Fallback explícito reconstruido desde state.strategies[].trades porque paperEvidenceLedger todavía no está disponible. No modifica parámetros ni decisiones.</div>'
        + '<div class="grid">'
        + metric('Movimientos retenidos', rows.length)
        + metric('Compras / ventas', buys + ' / ' + sells)
        + metric('Cierres con resultado', closed.length)
        + metric('PnL neto retenido', eur(pnl), cls(pnl))
        + metric('Fuente', 'Trades persistidos')
        + metric('Influye en trading', 'No')
        + '</div><div class="list" style="margin-top:12px">'
        + recent.map(row => '<div class="item"><b>' + esc(row.s.symbol || row.s.id || 'Operación') + ' · '
          + (row.t.side === 'buy' ? 'COMPRA' : 'VENTA') + '</b><div class="sub">' + dt(row.t.timestamp)
          + ' · ' + esc(row.t.reason || 'Sin explicación persistida') + '</div></div>').join('')
        + '</div><div class="banner warn"><b>Aprendizaje solo observacional.</b> Esta reconstrucción nunca cambia estrategia, umbrales, PAPER ni LIVE.</div></article>';
    };
  }
})();`;
