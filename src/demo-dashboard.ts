import { standaloneDemoDashboard } from "./demo-dashboard-standalone";

const PAPER_FALLBACK_SCRIPT = `<script>
(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const eur = (value) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(number(value));
  const date = (value) => value ? new Date(number(value)).toLocaleString('es-ES') : '—';
  const lane = (value) => value === 'fast' ? 'Rápida' : value === 'intraday' ? 'Intradía' : value === 'swing' ? 'Swing' : String(value || '—');

  function allTrades(strategies) {
    return strategies.flatMap((strategy) => (Array.isArray(strategy.trades) ? strategy.trades : []).map((trade) => ({ strategy, trade })))
      .sort((left, right) => number(right.trade.timestamp) - number(left.trade.timestamp));
  }

  function historyMarkup(trades) {
    return '<div class="head"><div><h2>Historial completo</h2><div class="muted">' + trades.length + ' órdenes PAPER persistidas. Cada movimiento conserva su explicación.</div></div></div><div class="list">' + trades.map(({strategy, trade}) => {
      const buy = trade.side === 'buy';
      const net = buy ? number(trade.grossEur) + number(trade.feeEur) : number(trade.grossEur) - number(trade.feeEur);
      return '<details class="item"><summary><div class="order-head"><span class="side ' + (buy ? 'buy' : 'sell') + '">' + (buy ? 'COMPRA' : 'VENTA') + '</span><div><b>' + esc(strategy.symbol) + '</b><div class="sub">' + lane(strategy.lane) + ' · ' + esc(trade.reason) + '</div></div><time class="sub">' + date(trade.timestamp) + '</time></div></summary><div class="kvs"><div class="kv"><span>Precio unitario</span><strong>' + eur(trade.price) + '</strong></div><div class="kv"><span>Cantidad</span><strong>' + esc(trade.quantity) + '</strong></div><div class="kv"><span>Importe</span><strong>' + eur(trade.grossEur) + '</strong></div><div class="kv"><span>Comisión</span><strong class="negative">' + eur(trade.feeEur) + '</strong></div><div class="kv"><span>' + (buy ? 'Total descontado' : 'Neto recibido') + '</span><strong>' + eur(net) + '</strong></div><div class="kv"><span>PnL neto</span><strong class="' + (number(trade.pnlEur) > 0 ? 'positive' : number(trade.pnlEur) < 0 ? 'negative' : '') + '">' + (typeof trade.pnlEur === 'number' ? eur(trade.pnlEur) : 'Abierta') + '</strong></div></div></details>';
    }).join('') + '</div>';
  }

  function evidenceMarkup(payload, strategies, trades) {
    const report = payload.paperEvidenceLedger || {};
    const status = payload.paperEvidenceLedgerStatus || {};
    const movements = number(report.totalMovements) || trades.length;
    const buys = number(report.buys) || trades.filter(({trade}) => trade.side === 'buy').length;
    const sells = number(report.sells) || trades.filter(({trade}) => trade.side === 'sell').length;
    const closed = number(report.closedTrades) || trades.filter(({trade}) => trade.side === 'sell' && Number.isFinite(Number(trade.pnlEur))).length;
    const strategyCount = number(report.strategyCount) || strategies.filter((strategy) => Array.isArray(strategy.trades) && strategy.trades.length > 0).length;
    return '<div class="head"><div><h2>Evidencia PAPER</h2><div class="muted">Registro persistente e independiente de la vista. Nunca habilita LIVE ni cambia parámetros por sí solo.</div></div><span class="status ' + (status.available === false ? 'bad' : 'ok') + '">' + (status.available === false ? 'DEGRADADA' : 'ACTIVA') + '</span></div><div class="grid"><div class="metric"><span>Movimientos retenidos</span><strong>' + movements + '</strong></div><div class="metric"><span>Estrategias con evidencia</span><strong>' + strategyCount + '</strong></div><div class="metric"><span>Compras / ventas</span><strong>' + buys + ' / ' + sells + '</strong></div><div class="metric"><span>Ciclos cerrados</span><strong>' + closed + '</strong></div></div><div class="banner warn"><b>Aprendizaje controlado.</b> Cada operación alimenta análisis y propuestas, pero cualquier cambio de estrategia debe validarse en una cohorte PAPER nueva antes de revisión humana.</div>';
  }

  async function repairPanels() {
    try {
      const response = await fetch('/api/lab', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const strategies = Array.isArray(payload?.state?.strategies) ? payload.state.strategies : [];
      const trades = allTrades(strategies);
      const history = document.getElementById('history');
      const evidence = document.getElementById('evidence');
      if (history && trades.length > 0 && (!history.textContent.trim() || /0 órdenes|sin historial|cargando/i.test(history.textContent))) {
        history.innerHTML = historyMarkup(trades);
      }
      if (evidence && trades.length > 0 && (!evidence.textContent.trim() || /sin evidencia|0 movimientos|cargando/i.test(evidence.textContent))) {
        evidence.innerHTML = evidenceMarkup(payload, strategies, trades);
      }
    } catch {
      // La DEMO base conserva su propio aviso; este respaldo nunca altera la operativa.
    }
  }

  window.addEventListener('load', () => setTimeout(repairPanels, 300));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('tab')) setTimeout(repairPanels, 80);
    if (target instanceof HTMLElement && target.id === 'refresh') setTimeout(repairPanels, 500);
  });
})();
</script>`;

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
    .replace("JSON.stringify", "String")
    .replace("</body>", `${PAPER_FALLBACK_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
