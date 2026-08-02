import { standaloneDemoDashboard } from "./demo-dashboard-standalone";

const PAPER_FALLBACK_SCRIPT = `<script>
(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const eur = (value) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(number(value));
  const date = (value) => value ? new Date(number(value)).toLocaleString('es-ES') : '—';
  const lane = (value) => value === 'fast' ? 'Rápida' : value === 'intraday' ? 'Intradía' : value === 'swing' ? 'Swing' : String(value || '—');
  const pct = (value) => new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(number(value));

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
    if (!panel && system && system.parentElement) {
      panel = document.createElement('section');
      panel.id = 'news';
      panel.className = 'panel view';
      system.parentElement.insertBefore(panel, system);
    }
    return panel;
  }

  function urgencyClass(value) {
    return value === 'critical' ? 'bad' : value === 'high' ? 'warn' : 'ok';
  }

  function newsMarkup(payload) {
    const report = payload.newsIntelligence || {};
    const signals = Array.isArray(report.signals) ? report.signals : [];
    const statuses = Array.isArray(report.sourceStatus) ? report.sourceStatus : [];
    const available = statuses.filter((item) => item.available === true).length;
    const unavailable = statuses.length - available;
    const critical = signals.filter((item) => item.urgency === 'critical').length;
    const high = signals.filter((item) => item.urgency === 'high').length;
    const corroborated = signals.filter((item) => number(item.corroboratingSources) > 1 || item.corroborated === true).length;
    const assetSet = new Set(signals.flatMap((item) => Array.isArray(item.assets) ? item.assets : []));
    const sourceCards = statuses.map((item) => '<div class="metric"><span>' + esc(item.label || item.id) + '</span><strong class="' + (item.available ? 'positive' : 'negative') + '">' + (item.available ? 'ACTIVA · ' + number(item.items) : 'CAÍDA') + '</strong><div class="sub">Latencia ' + number(item.latencyMs) + ' ms' + (item.error ? ' · ' + esc(item.error) : '') + '</div></div>').join('');
    const signalCards = signals.slice(0, 30).map((item) => {
      const assets = Array.isArray(item.assets) ? item.assets.join(', ') : '—';
      const topics = Array.isArray(item.topics) ? item.topics.join(', ') : '—';
      const entities = Array.isArray(item.entities) ? item.entities.join(', ') : '—';
      const reasons = Array.isArray(item.reasons) ? item.reasons.join(' · ') : 'Sin explicación';
      return '<details class="item"><summary><div class="order-head"><span class="status ' + urgencyClass(item.urgency) + '">' + esc(String(item.urgency || 'normal').toUpperCase()) + '</span><div><b>' + esc(item.title) + '</b><div class="sub">' + esc(item.source) + ' · impacto ' + number(item.impactScore) + '/100 · confianza ' + pct(item.confidence) + '</div></div><time class="sub">' + date(item.publishedAt || item.detectedAt) + '</time></div></summary><div class="kvs"><div class="kv"><span>Dirección probable</span><strong>' + esc(item.direction || 'neutral') + '</strong></div><div class="kv"><span>Activos afectados</span><strong>' + esc(assets) + '</strong></div><div class="kv"><span>Temas</span><strong>' + esc(topics) + '</strong></div><div class="kv"><span>Entidades</span><strong>' + esc(entities) + '</strong></div><div class="kv"><span>Corroboración</span><strong>' + number(item.corroboratingSources || 1) + ' fuente(s)</strong></div><div class="kv"><span>Explicación</span><strong>' + esc(reasons) + '</strong></div></div></details>';
    }).join('');
    return '<div class="head"><div><h2>Centro Mundial de Noticias</h2><div class="muted">Fuentes primarias, geopolítica, macroeconomía, regulación, ciberseguridad, energía y estado operativo. Actualización objetivo: ' + number(report.refreshTargetSeconds || 60) + ' segundos.</div></div><span class="status ' + (unavailable ? 'warn' : 'ok') + '">' + available + '/' + statuses.length + ' FUENTES</span></div><div class="grid"><div class="metric"><span>Alertas críticas</span><strong class="' + (critical ? 'negative' : '') + '">' + critical + '</strong></div><div class="metric"><span>Alertas altas</span><strong class="' + (high ? 'negative' : '') + '">' + high + '</strong></div><div class="metric"><span>Eventos corroborados</span><strong>' + corroborated + '</strong></div><div class="metric"><span>Activos vigilados</span><strong>' + assetSet.size + '</strong></div><div class="metric"><span>Fuentes disponibles</span><strong class="positive">' + available + '</strong></div><div class="metric"><span>Fuentes con fallo</span><strong class="' + (unavailable ? 'negative' : '') + '">' + unavailable + '</strong></div></div><div class="banner warn"><b>Inteligencia, no adivinación.</b> Una noticia nunca ejecuta una orden por sí sola. Se cruza con precio, liquidez, costes, riesgo y evidencia histórica.</div><div class="section-stack"><div><h3 class="mini-title">Estado de fuentes</h3><div class="grid">' + (sourceCards || '<div class="empty">No hay estado de fuentes disponible.</div>') + '</div></div><div><h3 class="mini-title">Alertas mundiales priorizadas</h3><div class="list">' + (signalCards || '<div class="empty">No hay alertas disponibles ahora mismo. El sistema seguirá consultando las fuentes.</div>') + '</div></div></div>';
  }

  function activateView(name) {
    document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node.getAttribute('data-view') === name));
    document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === name));
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
      if (history && trades.length > 0 && (!history.textContent.trim() || /0 órdenes|sin historial|cargando/i.test(history.textContent))) history.innerHTML = historyMarkup(trades);
      if (evidence && trades.length > 0 && (!evidence.textContent.trim() || /sin evidencia|0 movimientos|cargando/i.test(evidence.textContent))) evidence.innerHTML = evidenceMarkup(payload, strategies, trades);
      if (news) news.innerHTML = newsMarkup(payload);
    } catch {
      const news = ensureNewsPanel();
      if (news) news.innerHTML = '<div class="head"><div><h2>Centro Mundial de Noticias</h2><div class="muted">No se pudo cargar el estado en este intento.</div></div><span class="status bad">DEGRADADO</span></div><div class="banner bad">El fallo informativo no activa LIVE ni modifica operaciones PAPER.</div>';
    }
  }

  window.addEventListener('load', () => setTimeout(repairPanels, 300));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('tab')) {
      const view = target.getAttribute('data-view');
      if (view) activateView(view);
      setTimeout(repairPanels, 80);
    }
    if (target instanceof HTMLElement && target.id === 'refresh') setTimeout(repairPanels, 500);
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
    .replace("Las pérdidas y comisiones cerradas permanecen contabilizadas", "las pérdidas y comisiones cerradas permanecen contabilizadas")
    .replace("el patrón sin ganadoras", "el patrón 0 ganadoras")
    .replace("a.closed+=n(p.closedTrades);a.wins+=n(p.winningTrades);a.losses+=n(p.losingTrades);", "const closed=(Array.isArray(s.trades)?s.trades:[]).filter(t=>t.side==='sell'&&Number.isFinite(Number(t.pnlEur)));a.closed+=closed.length;a.wins+=closed.filter(t=>n(t.pnlEur)>0).length;a.losses+=closed.filter(t=>n(t.pnlEur)<0).length;")
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String")
    .replace("</body>", `${PAPER_FALLBACK_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
