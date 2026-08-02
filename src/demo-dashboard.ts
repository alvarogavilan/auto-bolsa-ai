import { standaloneDemoDashboard } from "./demo-dashboard-standalone";
import { DEMO_LIVE_PRICES_SCRIPT } from "./demo-live-prices";

const PAPER_AUDIT_SCRIPT = `<script>
(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[char]));
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const eur = (value) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(num(value));
  const date = (value) => value ? new Date(num(value)).toLocaleString('es-ES') : '—';

  function allTrades(strategies) {
    return strategies.flatMap((strategy) => (Array.isArray(strategy.trades) ? strategy.trades : []).map((trade) => ({ strategy, trade })))
      .sort((left, right) => num(right.trade.timestamp) - num(left.trade.timestamp));
  }

  function ensureNewsPanel() {
    let tab = document.querySelector('[data-view="news"]');
    let panel = document.getElementById('news');
    const tabs = document.querySelector('.tabs');
    const system = document.getElementById('system');
    if (!tab && tabs) {
      tab = document.createElement('button');
      tab.className = 'tab';
      tab.setAttribute('data-view', 'news');
      tab.textContent = 'Noticias';
      tabs.insertBefore(tab, tabs.querySelector('[data-view="system"]'));
    }
    if (!panel && system?.parentElement) {
      panel = document.createElement('section');
      panel.id = 'news';
      panel.className = 'panel view';
      system.parentElement.insertBefore(panel, system);
    }
    return panel;
  }

  function historyMarkup(trades) {
    return '<div class="head"><div><h2>Historial completo</h2><div class="muted">' + trades.length + ' órdenes PAPER persistidas. Cada compra y venta conserva su explicación.</div></div></div><div class="list">' + trades.map(({strategy, trade}) => {
      const buy = trade.side === 'buy';
      return '<details class="item"><summary><div class="order-head"><span class="side ' + (buy ? 'buy' : 'sell') + '">' + (buy ? 'COMPRA' : 'VENTA') + '</span><div><b>' + esc(strategy.symbol) + '</b><div class="sub">' + esc(trade.reason || 'Sin explicación') + '</div></div><time class="sub">' + date(trade.timestamp) + '</time></div></summary><div class="kvs"><div class="kv"><span>Precio</span><strong>' + eur(trade.price) + '</strong></div><div class="kv"><span>Cantidad</span><strong>' + esc(trade.quantity) + '</strong></div><div class="kv"><span>Importe</span><strong>' + eur(trade.grossEur) + '</strong></div><div class="kv"><span>Comisión</span><strong class="negative">' + eur(trade.feeEur) + '</strong></div><div class="kv"><span>PnL neto</span><strong class="' + (num(trade.pnlEur) > 0 ? 'positive' : num(trade.pnlEur) < 0 ? 'negative' : '') + '">' + (typeof trade.pnlEur === 'number' ? eur(trade.pnlEur) : 'Abierta') + '</strong></div></div></details>';
    }).join('') + '</div>';
  }

  function evidenceMarkup(payload, trades) {
    const report = payload.paperEvidenceLedger || {};
    const sells = trades.filter(({trade}) => trade.side === 'sell' && Number.isFinite(Number(trade.pnlEur)));
    const wins = sells.filter(({trade}) => num(trade.pnlEur) > 0).length;
    const losses = sells.filter(({trade}) => num(trade.pnlEur) < 0).length;
    return '<div class="head"><div><h2>Evidencia PAPER</h2><div class="muted">Fuente única reconstruida desde ventas persistidas y PnL neto.</div></div><span class="status ok">ACTIVA</span></div><div class="grid"><div class="metric"><span>Movimientos retenidos</span><strong>' + (num(report.totalMovements) || trades.length) + '</strong></div><div class="metric"><span>Ciclos cerrados</span><strong>' + sells.length + '</strong></div><div class="metric"><span>Ganadas netas</span><strong class="positive">' + wins + '</strong></div><div class="metric"><span>Perdidas netas</span><strong class="negative">' + losses + '</strong></div></div><div class="banner warn"><b>0/' + sells.length + ' no se maquilla.</b> Si todas son negativas, el historial lo confirma operación por operación y la estrategia continúa NO APTA LIVE.</div>';
  }

  function newsMarkup(payload) {
    const report = payload.newsIntelligence || {};
    const signals = Array.isArray(report.signals) ? report.signals : [];
    const statuses = Array.isArray(report.sourceStatus) ? report.sourceStatus : [];
    const available = statuses.filter((item) => item.available).length;
    const cards = signals.slice(0, 25).map((item) => '<details class="item"><summary><b>' + esc(item.title) + '</b><div class="sub">' + esc(item.source) + ' · impacto ' + num(item.impactScore) + '/100 · ' + esc(item.direction || 'neutral') + '</div></summary><div class="kvs"><div class="kv"><span>Activos</span><strong>' + esc(Array.isArray(item.assets) ? item.assets.join(', ') : '—') + '</strong></div><div class="kv"><span>Corroboración</span><strong>' + num(item.corroboratingSources || 1) + ' fuente(s)</strong></div><div class="kv"><span>Razones</span><strong>' + esc(Array.isArray(item.reasons) ? item.reasons.join(' · ') : '—') + '</strong></div></div></details>').join('');
    return '<div class="head"><div><h2>Centro Mundial de Noticias</h2><div class="muted">Noticias verificadas aplicadas como filtro y ajuste de tamaño exclusivamente en PAPER.</div></div><span class="status ' + (available === statuses.length ? 'ok' : 'warn') + '">' + available + '/' + statuses.length + ' FUENTES</span></div><div class="banner warn"><b>Aplicación operativa segura.</b> Las noticias pueden reducir o vetar una entrada PAPER, pero nunca ejecutan una orden real por sí solas.</div><div class="list">' + (cards || '<div class="empty">Sin alertas priorizadas en este momento.</div>') + '</div>';
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
      const news = ensureNewsPanel();
      if (history && trades.length) history.innerHTML = historyMarkup(trades);
      if (evidence) evidence.innerHTML = evidenceMarkup(payload, trades);
      if (news) news.innerHTML = newsMarkup(payload);
    } catch {
      const news = ensureNewsPanel();
      if (news) news.innerHTML = '<div class="banner bad">Noticias degradadas en este intento. PAPER continúa y LIVE permanece bloqueado.</div>';
    }
  }

  window.addEventListener('load', () => setTimeout(repairPanels, 300));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains('tab')) {
      const view = target.getAttribute('data-view');
      if (view) {
        document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node.getAttribute('data-view') === view));
        document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view));
      }
      setTimeout(repairPanels, 80);
    }
    if (target.id === 'refresh') setTimeout(repairPanels, 400);
  });
})();
</script>`;

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
    .replace("</body>", `${PAPER_AUDIT_SCRIPT}${DEMO_LIVE_PRICES_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
